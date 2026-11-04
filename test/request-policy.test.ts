import { createServer } from "node:http";

import { Errors } from "incur";
import { Errors as PolicyErrors, Funder, Policy } from "machine-fetch";
import { Challenge, Credential } from "mppx";
import { Mppx } from "mppx/client";
import { ousd } from "viem/tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestOptions } from "../src/request/options.js";
import {
  chargePolicyError,
  chargeWithinMaxSpend,
  createChargeCredential,
} from "../src/request/policy.js";
import { runRequest } from "../src/request/run.js";
import { MaxSpendExceededError } from "../src/request/spend.js";
import { testWallet, usdc, useTempHome } from "./helpers.js";

vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return { ...actual, Mppx: { ...actual.Mppx } };
});

const pathUsd = "0x20c0000000000000000000000000000000000000";
const privateKey = `0x${"1".repeat(64)}`;

function charge(options: { amount: string; currency?: string; id?: string; chainId?: number }) {
  return Challenge.from({
    id: options.id ?? "policy-charge",
    intent: "charge",
    method: "tempo",
    realm: "example.com",
    request: {
      amount: options.amount,
      currency: options.currency ?? usdc,
      recipient: testWallet,
      methodDetails: { chainId: options.chainId ?? 4217 },
    },
  });
}

function requestOptions(options: Partial<RequestOptions> = {}): RequestOptions {
  return {
    data: [],
    dataUrlencode: [],
    form: [],
    headers: [],
    paymentIntent: "charge",
    url: "https://example.com/paid",
    network: "mainnet",
    ...options,
  };
}

function challengeResponse(challenge: Challenge.Challenge) {
  return new Response(null, {
    status: 402,
    headers: { "www-authenticate": Challenge.serialize(challenge) },
  });
}

/**
 * An mppx client that selects `selected` (the offered challenge by default) and records each step:
 * a credential is signed only when `sign` appears.
 */
function mppxClient(selected?: Challenge.Challenge) {
  const steps: string[] = [];
  const contexts: unknown[] = [];
  return {
    steps,
    contexts,
    async preparePayment(response: Response) {
      steps.push("select");
      const challenge = selected ?? Challenge.fromResponseList(response)[0]!;
      return {
        challenge,
        async createCredential(context?: unknown) {
          steps.push("sign");
          contexts.push(context);
          return Credential.serialize({ challenge, payload: { type: "hash", hash: "0x01" } });
        },
      };
    },
  };
}

describe("createChargeCredential", () => {
  it("signs a charge within --max-spend after funding supplies OUSD auto-swap", async () => {
    const offered = charge({ amount: "1000000" });
    const client = mppxClient();
    const credential = await createChargeCredential(client, challengeResponse(offered), {
      challenge: offered,
      payer: testWallet,
      request: requestOptions({ maxSpend: "1" }),
    });
    expect(Credential.deserialize(credential).challenge.id).toBe(offered.id);
    expect(client.steps).toEqual(["select", "sign"]);
    // The Tempo funder ran before signing: mppx swaps only from OUSD, within the default slippage.
    expect(client.contexts).toEqual([
      { autoSwap: { tokenIn: [ousd.addresses[4217]], slippage: 1, fallback: false } },
    ]);
  });

  it("never swaps from stablecoins for an explicit MACH payment", async () => {
    const offered = charge({ amount: "1000000" });
    const client = mppxClient();
    await createChargeCredential(client, challengeResponse(offered), {
      challenge: offered,
      payer: testWallet,
      request: requestOptions({ maxSpend: "1", paymentToken: "mach" }),
    });
    expect(client.contexts).toEqual([{ autoSwap: false }]);
  });

  it("leaves a charge in an unlisted token to mppx without auto-swap", async () => {
    const token = "0x20c0000000000000000000000000000000000abc";
    const offered = charge({ amount: "1000000", currency: token });
    const client = mppxClient();
    await createChargeCredential(client, challengeResponse(offered), {
      challenge: offered,
      payer: testWallet,
      request: requestOptions({ maxSpend: "1" }),
    });
    expect(client.steps).toEqual(["select", "sign"]);
    expect(client.contexts).toEqual([{ autoSwap: false }]);
  });

  it.each([
    {
      name: "a charge mppx selects above --max-spend",
      selected: charge({ amount: "2000000" }),
      error: { code: "E_LIMIT_EXCEEDED", required: "2" },
      maxSpendError: true,
    },
    {
      name: "a charge mppx selects in another token",
      selected: charge({ amount: "1000", currency: pathUsd }),
      error: { code: "E_LIMIT_EXCEEDED" },
      maxSpendError: false,
    },
    {
      name: "a charge mppx selects on another chain",
      selected: charge({ amount: "1000", chainId: 42431 }),
      error: { code: "E_LIMIT_EXCEEDED" },
      maxSpendError: false,
    },
  ])("refuses $name before signing", async ({ selected, error, maxSpendError }) => {
    const offered = charge({ amount: "1000000" });
    const client = mppxClient(selected);
    const caught = await createChargeCredential(client, challengeResponse(offered), {
      challenge: offered,
      payer: testWallet,
      request: requestOptions({ maxSpend: "1" }),
    }).catch((caught: unknown) => caught);
    expect(caught).toMatchObject(error);
    expect(caught instanceof MaxSpendExceededError).toBe(maxSpendError);
    expect(client.steps).toEqual(["select"]);
  });

  it("applies the default cap when no --max-spend is set", async () => {
    const offered = charge({ amount: "10000001" });
    const client = mppxClient();
    await expect(
      createChargeCredential(client, challengeResponse(offered), {
        challenge: offered,
        payer: testWallet,
        request: requestOptions(),
      }),
    ).rejects.toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: "Payment max spend exceeded: max=10 (default) required=10.000001",
    });
    expect(client.steps).toEqual(["select"]);
  });

  it("keeps a signing failure for the caller to classify", async () => {
    const offered = charge({ amount: "1000" });
    const failure = new Error("SpendingLimitExceeded");
    const client = {
      async preparePayment() {
        return {
          challenge: offered,
          createCredential: () => Promise.reject(failure),
        };
      },
    };
    await expect(
      createChargeCredential(client, challengeResponse(offered), {
        challenge: offered,
        payer: testWallet,
        request: requestOptions(),
      }),
    ).rejects.toBe(failure);
  });
});

describe("chargePolicyError", () => {
  const offered = charge({ amount: "2000000" });
  const options = requestOptions({ maxSpend: "1" });
  const asset = { network: "eip155:4217", asset: ousd.addresses[4217] };

  it.each([
    {
      name: "a limit the charge exceeds",
      error: new Policy.LimitExceededError("Payment exceeds maxPayment"),
      expected: { code: "E_LIMIT_EXCEEDED", exitCode: 4, required: "2" },
    },
    {
      name: "an invalid challenge",
      error: new Policy.InvalidPaymentError("Payment amount cannot be negative"),
      expected: {
        code: "E_PAYMENT",
        message: "Payment challenge refused: Payment amount cannot be negative",
      },
    },
    {
      name: "funding that may have moved funds",
      error: new Funder.FundingRecoveryError("op-1"),
      expected: {
        code: "E_PAYMENT_OUTCOME_UNKNOWN",
        message: expect.stringContaining("operation op-1"),
      },
    },
    {
      name: "a route the signer's spending limit refuses",
      error: new Funder.NoRouteError("No route", {
        cause: new Funder.FundingLimitError({
          ...asset,
          required: 2_000_000n,
          limit: 500_000n,
          setting: "spendLimit",
        }),
      }),
      expected: {
        code: "E_LIMIT_EXCEEDED",
        message: expect.stringContaining("access key's remaining spending limit of 0.5"),
      },
    },
    {
      name: "a route the balance cannot fund",
      error: new Funder.NoRouteError("No route", {
        cause: new Funder.SourceBalanceError({ ...asset, required: 2_000_000n, held: 1n }),
      }),
      expected: { code: "E_INSUFFICIENT_FUNDS", exitCode: 4 },
    },
    {
      name: "no route at all",
      error: new Funder.NoRouteError("No route"),
      expected: { code: "E_PAYMENT", retryable: false },
    },
    {
      name: "a funding failure before funds moved",
      error: new Funder.FundingError("Quote expired"),
      expected: { code: "E_PAYMENT", retryable: true },
    },
    {
      name: "a credential for another challenge",
      error: new PolicyErrors.InvalidConfigurationError(
        "The signed credential answers a different challenge",
      ),
      expected: {
        code: "E_PAYMENT",
        message:
          "Payment refused before signing: The signed credential answers a different challenge",
      },
    },
  ])("maps $name", ({ error, expected }) => {
    const mapped = chargePolicyError(error, offered, options);
    expect(mapped).toBeInstanceOf(Errors.IncurError);
    expect(mapped).toMatchObject(expected);
  });

  it("maps a limit the charge fits to E_LIMIT_EXCEEDED without a --max-spend rerun", () => {
    const mapped = chargePolicyError(
      new Policy.LimitExceededError("Payment asset has no maxPayment limit"),
      charge({ amount: "1" }),
      options,
    );
    expect(mapped).toMatchObject({ code: "E_LIMIT_EXCEEDED" });
    expect(mapped).not.toBeInstanceOf(MaxSpendExceededError);
  });

  it("leaves other errors alone", () => {
    expect(chargePolicyError(new Error("rpc down"), offered, options)).toBeUndefined();
  });
});

describe("chargeWithinMaxSpend", () => {
  it.each([
    { amount: "1000000", maxSpend: "1", within: true },
    { amount: "1000001", maxSpend: "1", within: false },
    { amount: "10000000", maxSpend: undefined, within: true },
    { amount: "10000001", maxSpend: undefined, within: false },
  ])("reports $amount under $maxSpend as $within", async ({ amount, maxSpend, within }) => {
    expect(await chargeWithinMaxSpend(charge({ amount }), requestOptions({ maxSpend }))).toBe(
      within,
    );
  });
});

describe("tempo request charge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends nothing when the challenge mppx selects exceeds the cap wallet-cli checked", async () => {
    await useTempHome();
    const offered = charge({ amount: "1000000" });
    const selected = charge({ amount: "5000000" });
    const paid: string[] = [];
    const server = createServer((request, response) => {
      if (request.headers.authorization) paid.push(request.headers.authorization);
      response.statusCode = 402;
      response.setHeader("www-authenticate", Challenge.serialize(offered));
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const client = mppxClient(selected);
    vi.spyOn(Mppx, "create").mockReturnValue({
      ...client,
      transport: { setCredential: (init: RequestInit) => init },
    } as unknown as ReturnType<typeof Mppx.create>);
    try {
      await expect(
        runRequest(
          [
            "--private-key",
            privateKey,
            "--max-spend",
            "1",
            `http://127.0.0.1:${address.port}/paid`,
          ],
          { stdout: { write: () => true }, stderr: { write: () => true } },
        ),
      ).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED", required: "5" });
      expect(client.steps).toEqual(["select"]);
      expect(paid).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
