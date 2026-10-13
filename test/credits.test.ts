import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hashTypedData, parseAbi } from "viem";
import { Challenge } from "mppx";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/provider.js", () => ({ createProvider: () => ({ request: mocks.request }) }));

import { whoamiHandler } from "../src/commands/identity.js";
import { transferCredits } from "../src/commands/transfer.js";
import { validateCreditPermit } from "../src/commands/credits.js";
import { appUrl } from "../src/shared/network.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
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
const challenge = `Payment realm="example", method="tempo", intent="charge", id="abc123", expires="2099-01-01T00:00:00Z", request="${Buffer.from(
  JSON.stringify({
    amount: "1000000",
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217 },
  }),
).toString("base64url")}"`;

beforeEach(async () => {
  vi.stubEnv("TEMPO_MAX_SPEND", "5");
  await useTempHome();
  await writeWalletState(walletState());
  mocks.request.mockReset().mockResolvedValue(signature);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

describe("legacy credit spending", () => {
  it("previews a direct legacy calldata payment", async () => {
    const result = await transferCredits({
      options: {
        "amount-cents": 100,
        to: recipient,
        data: "0xabcdef",
        value: "0",
        "dry-run": true,
      },
    });
    expect(result).toMatchObject({
      amount_cents: 100,
      dry_run: true,
      to: recipient,
      transaction_data: { transaction: { to: recipient, data: "0xabcdef" } },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("accepts PathUSD challenges on testnet", async () => {
    const offer = Challenge.deserialize(challenge);
    offer.request.currency = moderatoToken;
    offer.request.methodDetails = { chainId: 42431 };
    await expect(
      transferCredits({
        options: {
          "mpp-challenge": Challenge.serialize(offer),
          network: "testnet",
          "dry-run": true,
        },
      }),
    ).resolves.toMatchObject({ amount_cents: 100, token: moderatoToken, chain_id: 42431 });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([{ amount: "15000" }, { currency: moderatoToken }])(
    "rejects unsupported precision or currency: %j",
    async (request) => {
      const offer = Challenge.deserialize(challenge);
      Object.assign(offer.request, request);
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({ code: "E_USAGE" });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    "!!!!",
    ...["not-json", "null", "[]", "5"].map((s) => Buffer.from(s).toString("base64url")),
  ])("rejects missing or malformed challenge requests: %s", async (request) => {
    const header = `Payment realm="example", method="tempo", intent="charge", id="abc123"${request ? `, request="${request}"` : ""}`;
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(transferCredits({ options: { "mpp-challenge": header } })).rejects.toMatchObject({
      code: "E_USAGE",
      message: "Invalid configuration: invalid MPP challenge",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["inline", "file"])(
    "rejects oversized %s challenges before parsing or spending",
    async (source) => {
      const offer = Challenge.deserialize(challenge);
      offer.request.amount = "9".repeat(1024 * 1024);
      const input = Challenge.serialize(offer);
      const path = join(process.env.HOME!, "challenge.txt");
      if (source === "file") await writeFile(path, input);
      const fetch = vi.spyOn(globalThis, "fetch");
      for (const dryRun of [true, false]) {
        await expect(
          transferCredits({
            options: {
              ...(source === "file" ? { "mpp-challenge-file": path } : { "mpp-challenge": input }),
              "dry-run": dryRun,
            },
          }),
        ).rejects.toMatchObject({
          code: "E_USAGE",
          message: expect.stringContaining("64 KiB size limit"),
        });
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["inline", "file"])("accepts a %s challenge at the size limit", async (source) => {
    const input = challenge.padEnd(64 * 1024, " ");
    const path = join(process.env.HOME!, "challenge.txt");
    if (source === "file") await writeFile(path, input);
    await expect(
      transferCredits({
        options: {
          ...(source === "file" ? { "mpp-challenge-file": path } : { "mpp-challenge": input }),
          "dry-run": true,
        },
      }),
    ).resolves.toMatchObject({ amount_cents: 100, to: recipient, dry_run: true });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("measures inline challenges in bytes rather than characters", async () => {
    const input = challenge + "é".repeat(32 * 1024);
    expect(input.length).toBeLessThan(64 * 1024);
    await expect(transferCredits({ options: { "mpp-challenge": input } })).rejects.toMatchObject({
      code: "E_USAGE",
      message: expect.stringContaining("64 KiB size limit"),
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("rejects oversized decimal amounts within a bounded challenge", async () => {
    const offer = Challenge.deserialize(challenge);
    offer.request.amount = "9".repeat(79);
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
    ).rejects.toMatchObject({
      code: "E_USAGE",
      message: "MPP challenge amount is too large",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["balance", "authorization"])(
    "rejects malformed %s JSON without leaking the body",
    async (operation) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad\u001b[2Jresponse"));
      const action =
        operation === "balance"
          ? whoamiHandler({ credits: true })
          : transferCredits({ options: { "mpp-challenge": challenge } });
      await expect(action).rejects.toMatchObject({
        code: "E_NETWORK",
        message:
          operation === "balance"
            ? "Coinflow balances response is not valid JSON"
            : "Coinflow credits authorization response is not valid JSON",
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("preserves the signature digest of the historical Coinflow testnet permit", () => {
    // The Coinflow fixture and expected digest from wallet-rs spend_credits.rs.
    vi.spyOn(Date, "now").mockReturnValue(1777483800000);
    const typed = JSON.parse(auth.message);
    typed.domain.chainId = 42431;
    typed.domain.verifyingContract = "0x02af2603e2A7d891684854CBC4aaeBa310bf7C1c";
    typed.message = {
      customerWallet: "0x480F8659821A7a5f6209cDA338A53E9Dea09DB46",
      creditSeed: "tempo-sandbox",
      amount: 1030000,
      validBefore: "1777483839",
      nonce: "0x7968399a1307417362f545e43d5a12eb942562dd8c181d41f68fd881f56ba23d",
    };
    const serialized = validateCreditPermit(
      {
        message: JSON.stringify(typed),
        validBefore: typed.message.validBefore,
        nonce: typed.message.nonce,
        creditsRawAmount: 1030000,
      },
      {
        wallet: typed.message.customerWallet,
        network: "testnet",
        amountCents: 100,
        maxSpend: "1.03",
      },
    );
    expect(hashTypedData(JSON.parse(serialized))).toBe(
      "0x3caf17f85e96e489a081eab08cdc14794d8725d4356ef252fc98de3c65e03225",
    );
  });

  it.each([[], ["pull"], ["push", "invalid"], "push", null])(
    "rejects unsupported payment modes before spending: %j",
    async (supportedModes) => {
      const offer = Challenge.deserialize(challenge);
      offer.request.methodDetails = { chainId: 4217, supportedModes };
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("push") });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ["push"], ["pull", "push"]])(
    "retains supported push payments: %j",
    async (supportedModes) => {
      const offer = Challenge.deserialize(challenge);
      offer.request.methodDetails = { supportedModes };
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(auth))
        .mockResolvedValueOnce(Response.json({ hash }));
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).resolves.toMatchObject({ tx_hash: hash });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.request).toHaveBeenCalledOnce();
    },
  );

  it.each(["42431", "4217", null, 4217.5, {}])(
    "rejects malformed challenge chain IDs before spending: %j",
    async (chainId) => {
      const offer = Challenge.deserialize(challenge);
      offer.request.methodDetails = { chainId };
      const fetch = vi.spyOn(globalThis, "fetch");
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("chain ID") });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["amount", "currency"])(
    "escapes terminal controls in challenge %s errors",
    async (field) => {
      const offer = Challenge.deserialize(challenge);
      offer.request[field] = "\u001b[2J\r\u202eevil";
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({
        code: "E_USAGE",
        message: expect.stringContaining(
          `\\u001b[2${field === "currency" ? "j" : "J"}\\u000d\\u202eevil`,
        ),
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["balance", "authorization"])(
    "bounds and escapes %s server errors",
    async (operation) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("\u001b[2J\r\u202eevil" + "x".repeat(10000), { status: 503 }),
      );
      const action =
        operation === "balance"
          ? whoamiHandler({ credits: true })
          : transferCredits({ options: { "mpp-challenge": challenge } });
      const error = await action.catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("\\u001b[2J\\u000d\\u202eevil");
      expect((error as Error).message.length).toBeLessThan(1000);
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "not-a-date", "2020-01-01T00:00:00Z", "2099-99-99T00:00:00Z"])(
    "rejects invalid or expired challenge expiry %s before signing",
    async (expires) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      const input = challenge.replace(
        /, expires="[^"]*"/,
        expires === undefined ? "" : `, expires="${expires}"`,
      );
      await expect(transferCredits({ options: { "mpp-challenge": input } })).rejects.toMatchObject({
        code: "E_USAGE",
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each(["id", "realm"])("rejects a challenge missing %s before authorization", async (field) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const input = challenge.replace(new RegExp(`${field}="[^"]*",? ?`), "");
    await expect(transferCredits({ options: { "mpp-challenge": input } })).rejects.toMatchObject({
      code: "E_USAGE",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["authorization", "signature"])(
    "does not redeem a challenge that expires during %s",
    async (stage) => {
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      const offer = Challenge.deserialize(challenge);
      offer.expires = new Date(now + 1_000).toISOString();
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        if (stage === "authorization") clock.mockReturnValue(now + 2_000);
        return Response.json(auth);
      });
      mocks.request.mockImplementation(async () => {
        if (stage === "signature") clock.mockReturnValue(now + 2_000);
        return signature;
      });
      await expect(
        transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
      ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("expired") });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects an invalid recipient checksum before authorization", async () => {
    const offer = Challenge.deserialize(challenge);
    offer.request.recipient = "0xABfB663C1F9cd7438f54846D6B827E315719eC0f";
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      transferCredits({ options: { "mpp-challenge": Challenge.serialize(offer) } }),
    ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("recipient") });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([undefined, 100])("requires a cap only for challenge spending: %s", async (cents) => {
    vi.stubEnv("TEMPO_MAX_SPEND", "");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(auth))
      .mockResolvedValueOnce(Response.json({ hash }));
    const options = { "mpp-challenge": challenge, "amount-cents": cents };
    await expect(
      transferCredits({ options: { ...options, "dry-run": true } }),
    ).resolves.toMatchObject({
      dry_run: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    if (cents === undefined) {
      await expect(transferCredits({ options })).rejects.toMatchObject({
        code: "E_USAGE",
        message: expect.stringContaining("require --amount-cents or TEMPO_MAX_SPEND"),
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    } else {
      await expect(transferCredits({ options })).resolves.toMatchObject({ tx_hash: hash });
    }
  });

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

  it.each([
    { "amount-cents": 100, to: recipient },
    { "mpp-challenge": challenge, "amount-cents": 100 },
  ])("signs and redeems existing credits without a MACH payment: %j", async (options) => {
    vi.stubEnv("TEMPO_MAX_SPEND", "");
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
  });

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
    { "amount-cents": 100, to: recipient, value: "1" },
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

it.each(
  ["balances", "auth-msg", "send"].flatMap((endpoint) =>
    ["headers", "body"].map((stalled) => ({ endpoint, stalled })),
  ),
)("aborts stalled $endpoint $stalled without retrying", async ({ endpoint, stalled }) => {
  const fetch = globalThis.fetch;
  const timeout = AbortSignal.timeout;
  const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(100));
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url!);
    if (request.url!.endsWith(endpoint)) {
      if (stalled === "body") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write("{");
      }
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(auth));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    vi.spyOn(globalThis, "fetch").mockImplementation((url, options) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, options),
    );
    const action =
      endpoint === "balances"
        ? whoamiHandler({ credits: true })
        : transferCredits({ options: { "mpp-challenge": challenge } });
    const error = await action.catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(deadline).toHaveBeenCalledWith(endpoint === "balances" ? 3_000 : 30_000);
    expect(paths).toHaveLength(endpoint === "send" ? 2 : 1);
    expect(paths.at(-1)).toMatch(new RegExp(`/${endpoint}$`));
    if (endpoint === "send") {
      expect(error).toMatchObject({ code: "E_PAYMENT_OUTCOME_UNKNOWN", retryable: false });
      expect(mocks.request).toHaveBeenCalledOnce();
    } else expect(mocks.request).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
