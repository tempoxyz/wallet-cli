import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

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
    domain: { name: "Credits", chainId: 4217 },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      PermitCredits: [{ name: "amount", type: "uint256" }],
    },
    primaryType: "PermitCredits",
    message: { amount: "10000" },
  }),
  validBefore: "2000000000",
  nonce: "1",
  creditsRawAmount: 10000,
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
  it.each([{ "amount-cents": 100, to: recipient }, { "mpp-challenge": challenge }])(
    "signs and redeems existing credits without a MACH payment: %j",
    async (options) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(auth))
        .mockResolvedValueOnce(Response.json({ hash }));
      const result = await transferCredits({ options });
      expect(result).toEqual({
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
      expect(JSON.parse(mocks.request.mock.calls[0]![0].params[1])).toMatchObject(
        JSON.parse(auth.message),
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
