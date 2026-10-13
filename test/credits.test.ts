import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hashTypedData, parseAbi } from "viem";
import { Challenge } from "mppx";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/provider.js", () => ({ createProvider: () => ({ request: mocks.request }) }));

import { whoamiHandler } from "../src/commands/identity.js";
import { transferCredits } from "../src/commands/transfer.js";
import { appUrl } from "../src/shared/network.js";
import { usdcToken } from "../src/shared/constants.js";
import { transferOutput, whoamiOutput } from "../src/schemas.js";
import { testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";
const hash = `0x${"12".repeat(32)}`;
const signature = "0xsigned";
const auth = {
  message: JSON.stringify({
    domain: {
      name: "Coinflow Credits Contract",
      version: "1",
      chainId: 4217,
      verifyingContract: "0x2222222222222222222222222222222222222222",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CreditsAuthorization: [
        { name: "customerWallet", type: "address" },
        { name: "creditSeed", type: "string" },
        { name: "amount", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "CreditsAuthorization",
    message: {
      customerWallet: testWallet.toLowerCase(),
      creditSeed: "tempo",
      amount: "1000000",
      validBefore: "2000000000",
      nonce: `0x${"ab".repeat(32)}`,
    },
  }),
  validBefore: "2000000000",
  nonce: `0x${"ab".repeat(32)}`,
  creditsRawAmount: 1000000,
};
const challenge = `Payment realm="example", method="tempo", intent="charge", id="abc123", request="${Buffer.from(
  JSON.stringify({
    amount: "1000000",
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217 },
  }),
).toString("base64url")}"`;

beforeEach(async () => {
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  await useTempHome();
  await writeWalletState(walletState());
  mocks.request.mockReset().mockResolvedValue(signature);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

describe("legacy credit spending", () => {
  it.each(["not-a-date", "2020-01-01T00:00:00Z", "2099-99-99T00:00:00Z"])(
    "rejects invalid or expired challenge expiry %s before signing",
    async (expires) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": `${challenge}, expires="${expires}"` } }),
      ).rejects.toMatchObject({ code: "E_USAGE" });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([[{ recipient, amount: "10000" }], "invalid", null])(
    "rejects unsupported split charges before signing: %j",
    async (splits) => {
      const offer = Challenge.deserialize(challenge);
      offer.request.methodDetails = { chainId: 4217, splits };
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({ code: "E_USAGE" });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("uses mppx's genuine challenge rather than Payment text in a quoted parameter", async () => {
    const fake = Challenge.deserialize(challenge);
    fake.request.recipient = "0x3333333333333333333333333333333333333333";
    const bait = Challenge.serialize(fake).replace(/"/g, '\\"');
    const header = `Basic realm="${bait}", ${challenge}`;
    const result = await transferCredits({ options: { "mpp-challenge": header, "dry-run": true } });
    expect(result).toMatchObject({
      to: recipient,
      token: usdcToken,
      chain_id: 4217,
      challenge_id: "abc123",
    });
    expect(transferOutput.parse(result)).toEqual(result);
    expect(Challenge.deserialize(header).request.recipient).toBe(result.to);
    expect(result.transaction_data).toMatchObject({ transaction: { to: usdcToken } });
    const transaction = (result.transaction_data as { transaction: { data: `0x${string}` } })
      .transaction;
    expect(
      decodeFunctionData({
        abi: parseAbi([
          "function transferWithMemo(address to, uint256 amount, bytes32 memo) returns (bool)",
        ]),
        data: transaction.data,
      }).args?.[0],
    ).toBe(recipient);
    const other = await transferCredits({
      options: { "mpp-challenge": Challenge.serialize(fake), "dry-run": true },
    });
    expect(other.to).toBe(fake.request.recipient);
    expect(other.transaction_data).not.toEqual(result.transaction_data);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    ["domain", "name", "Other"],
    ["domain", "version", "2"],
    ["domain", "chainId", 42431],
    ["domain", "verifyingContract", "0x0000000000000000000000000000000000000000"],
    ["message", "customerWallet", recipient],
    ["message", "creditSeed", "other-merchant"],
    ["message", "amount", "2000000"],
    ["message", "validBefore", "2000000001"],
    ["message", "nonce", `0x${"cd".repeat(32)}`],
  ])("rejects mismatched permit %s.%s before signing", async (part, field, value) => {
    const typed = JSON.parse(auth.message);
    typed[part as string][field as string] = value;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ...auth, message: JSON.stringify(typed) }));
    await expect(
      transferCredits({ options: { "mpp-challenge": challenge } }),
    ).rejects.toMatchObject({ code: "E_USAGE" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["schema", "primaryType", "json", "expired", "fractional amount", "missing amount"])(
    "rejects invalid permit %s before signing",
    async (invalid) => {
      const response = { ...auth };
      const typed = JSON.parse(auth.message);
      if (invalid === "schema") typed.types.CreditsAuthorization[2].type = "uint128";
      if (invalid === "primaryType") typed.primaryType = "Permit";
      if (invalid === "expired") response.validBefore = typed.message.validBefore = "1";
      if (invalid === "fractional amount") response.creditsRawAmount = 1.5;
      if (invalid === "missing amount") delete typed.message.amount;
      response.message = invalid === "json" ? "not-json" : JSON.stringify(typed);
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(response));
      await expect(
        transferCredits({ options: { "mpp-challenge": challenge } }),
      ).rejects.toMatchObject({ code: "E_USAGE" });
      expect(fetch).toHaveBeenCalledOnce();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["environment", "challenge"])(
    "caps the permit including fees with the %s budget",
    async (budget) => {
      const typed = JSON.parse(auth.message);
      typed.message.amount = "1020000";
      if (budget === "environment") vi.stubEnv("TEMPO_MAX_SPEND", "1");
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          Response.json({ ...auth, creditsRawAmount: 1020000, message: JSON.stringify(typed) }),
        );
      await expect(
        transferCredits({
          options: {
            "mpp-challenge": challenge,
            ...(budget === "challenge" ? { "amount-cents": 100 } : {}),
          },
        }),
      ).rejects.toMatchObject({
        code: "E_USAGE",
        message: expect.stringContaining("including fees exceeds"),
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("accepts a consistent permit with gas fees within the budget", async () => {
    vi.stubEnv("TEMPO_MAX_SPEND", "1.02");
    const typed = JSON.parse(auth.message);
    typed.message.amount = "1020000";
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ ...auth, creditsRawAmount: 1020000, message: JSON.stringify(typed) }),
      )
      .mockResolvedValueOnce(Response.json({ hash }));
    await expect(
      transferCredits({ options: { "mpp-challenge": challenge, "amount-cents": 102 } }),
    ).resolves.toMatchObject({ tx_hash: hash });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([{ "amount-cents": 100, to: recipient }, { "mpp-challenge": challenge }])(
    "signs and redeems existing credits without a MACH payment: %j",
    async (options) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(auth))
        .mockResolvedValueOnce(Response.json({ hash }));
      const result = await transferCredits({ options });
      expect(result).toMatchObject({
        wallet: testWallet.toLowerCase(),
        amount_cents: 100,
        tx_hash: hash,
      });
      expect(transferOutput.parse(result)).toEqual(result);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("--credits is deprecated"),
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${new URL(appUrl).origin}/api/coinflow/redeem/auth-msg`,
        `${new URL(appUrl).origin}/api/coinflow/redeem/send`,
      ]);
      const request = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
      expect(request).toMatchObject({
        wallet: testWallet.toLowerCase(),
        subtotal: { cents: 100, currency: "USD" },
      });
      if ("to" in options) {
        expect(request.transactionData).toEqual({ type: "token", destination: recipient });
      } else {
        expect(request.transactionData.transaction.to).toBe(usdcToken);
        const decoded = decodeFunctionData({
          abi: parseAbi([
            "function transferWithMemo(address to, uint256 amount, bytes32 memo) returns (bool)",
          ]),
          data: request.transactionData.transaction.data,
        });
        expect(decoded.args).toEqual([
          recipient,
          1000000n,
          expect.stringMatching(/^0x[0-9a-f]{64}$/),
        ]);
      }
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
        method: "eth_signTypedData_v4",
        params: [testWallet.toLowerCase(), expect.any(String)],
      });
      expect(hashTypedData(JSON.parse(mocks.request.mock.calls[0]![0].params[1]))).toBe(
        hashTypedData(JSON.parse(auth.message)),
      );
      expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({
        ...request,
        permitCreditsSignature: signature,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
        creditsRawAmount: auth.creditsRawAmount,
      });
    },
  );

  it.each([
    { options: { "mpp-challenge": challenge }, cap: "0.99" },
    { options: { "mpp-challenge": challenge, "amount-cents": 200 }, cap: "0.99" },
    { options: { "amount-cents": 100, to: recipient }, cap: "0.99" },
    { options: { "mpp-challenge": challenge }, cap: "0" },
    { options: { "mpp-challenge": challenge }, cap: "0.999999" },
  ])(
    "enforces TEMPO_MAX_SPEND before requesting a permit: $cap $options",
    async ({ options, cap }) => {
      vi.stubEnv("TEMPO_MAX_SPEND", cap);
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(transferCredits({ options })).rejects.toMatchObject({
        code: "E_USAGE",
        message: expect.stringContaining("exceeds TEMPO_MAX_SPEND"),
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it.each(["1", " 1.00 ", "1.000001", "2"])(
    "redeems credits within environment cap %s",
    async (cap) => {
      vi.stubEnv("TEMPO_MAX_SPEND", cap);
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(auth))
        .mockResolvedValueOnce(Response.json({ hash }));
      expect(await transferCredits({ options: { "mpp-challenge": challenge } })).toMatchObject({
        amount_cents: 100,
        tx_hash: hash,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.request).toHaveBeenCalledOnce();
    },
  );
  it.each(["-1", "NaN", "1e2", "0.0000001"])(
    "rejects invalid environment cap %s before signing",
    async (cap) => {
      vi.stubEnv("TEMPO_MAX_SPEND", cap);
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": challenge } }),
      ).rejects.toMatchObject({ code: "E_USAGE" });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    { to: "0x2222222222222222222222222222222222222222" },
    { to: recipient },
    { data: "0x" },
    { data: "0xabcdef" },
    { value: "0" },
    { value: "1" },
  ])("rejects direct-transfer flags alongside either challenge input: %j", async (flags) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const input of [{ "mpp-challenge": challenge }, { "mpp-challenge-file": "ignored.txt" }]) {
      for (const dryRun of [true, false]) {
        await expect(
          transferCredits({ options: { ...input, ...flags, "dry-run": dryRun } }),
        ).rejects.toMatchObject({
          code: "E_USAGE",
          message: expect.stringContaining("cannot be combined with an MPP challenge"),
        });
      }
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not sign or submit when fetching the permit fails", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(
      transferCredits({ options: { "amount-cents": 100, to: recipient } }),
    ).rejects.toMatchObject({ code: "E_NETWORK" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "missing hash", "invalid hash", "invalid JSON", "server error"])(
    "reports an unknown outcome after %s without retrying",
    async (failure) => {
      const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(auth));
      if (failure === "disconnect") fetch.mockRejectedValueOnce(new Error("connection lost"));
      else
        fetch.mockResolvedValueOnce(
          failure === "server error"
            ? new Response("Unavailable", { status: 502 })
            : failure === "invalid JSON"
              ? new Response("not json")
              : Response.json(failure === "invalid hash" ? { hash: "invalid" } : {}),
        );
      await expect(
        transferCredits({ options: { "amount-cents": 100, to: recipient } }),
      ).rejects.toMatchObject({ code: "E_PAYMENT_OUTCOME_UNKNOWN" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.request).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { "amount-cents": 0, to: recipient },
    { "amount-cents": -1, to: recipient },
    { "amount-cents": 1.5, to: recipient },
    { "amount-cents": Number.MAX_SAFE_INTEGER + 1, to: recipient },
    { "amount-cents": 99, "mpp-challenge": challenge },
    { "max-spend": "0.99", "mpp-challenge": challenge },
    { "mpp-challenge": challenge, "mpp-challenge-file": "ignored.txt" },
  ])("rejects unsafe or conflicting flags before signing: %j", async (options) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(transferCredits({ options })).rejects.toMatchObject({ code: "E_USAGE" });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("legacy credit balances", () => {
  it.each([
    [{ rawAmount: "123456" }, "12.3456", "123456"],
    [{ cents: 125 }, "1.2500", "12500"],
    [{ rawAmount: 0 }, "0", "0"],
  ])("reads the credit ledger instead of MACH: %j", async (credits, balance, rawBalance) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ credits }));
    const result = await whoamiHandler({ credits: true });
    expect(result).toEqual({ credits: { wallet: testWallet, balance, rawBalance } });
    expect(whoamiOutput.parse(result)).toEqual(result);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("--credits is deprecated"),
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(Object));
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/coinflow/balances");
    expect(url.searchParams.get("wallet")).toBe(testWallet);
  });

  it("rejects simultaneous MACH and credit selectors", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(whoamiHandler({ credits: true, mach: true })).rejects.toMatchObject({
      code: "E_USAGE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
