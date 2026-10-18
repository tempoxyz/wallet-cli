import { Challenge } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chargePolicy, maxPaymentAssets } from "../src/payment/funding.js";
import { checkCharge } from "../src/request/funding.js";
import type { RequestOptions } from "../src/request/options.js";
import { MaxSpendExceededError } from "../src/request/spend.js";
import { tempoUsdTokens } from "../src/shared/chains.js";
import { parseNetwork } from "../src/shared/network.js";
import { unlistedToken, usdc } from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";
const pathUsd = "0x20c0000000000000000000000000000000000000";
const mainnet = parseNetwork("mainnet");
const testnet = parseNetwork("testnet");

function options(overrides: Partial<RequestOptions> = {}): RequestOptions {
  return {
    data: [],
    dataUrlencode: [],
    form: [],
    headers: [],
    paymentIntent: "auto",
    url: "https://api.example.com",
    network: "mainnet",
    ...overrides,
  };
}

function charge(request: Record<string, unknown>, intent = "charge") {
  return Challenge.from({
    id: "challenge",
    intent,
    method: "tempo",
    realm: "api.example.com",
    request: { amount: "1000000", currency: usdc, recipient, ...request },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("--max-spend as maxPayment", () => {
  it.each([
    { name: "exactly the cap", amount: "1000000", maxSpend: "1", result: "planned" },
    { name: "one atomic unit over the cap", amount: "1000001", maxSpend: "1", result: "over" },
    { name: "the default cap", amount: "10000000", maxSpend: undefined, result: "planned" },
    { name: "over the default cap", amount: "10000001", maxSpend: undefined, result: "over" },
    { name: "a fractional cap", amount: "15000", maxSpend: "0.015", result: "planned" },
    { name: "an unlisted token", amount: "1", currency: unlistedToken, result: "uncapped" },
    {
      name: "a token listed on another network",
      amount: "1",
      network: "testnet",
      result: "uncapped",
    },
  ])(
    "plans a charge at $name: $result",
    async ({ amount, maxSpend, currency, network, result }) => {
      const challenge = charge({
        amount,
        ...(currency ? { currency } : {}),
        methodDetails: { chainId: network === "testnet" ? 42431 : 4217 },
      });
      const run = checkCharge(challenge, options({ maxSpend, ...(network ? { network } : {}) }));

      if (result === "planned")
        await expect(run).resolves.toMatchObject({ requirement: { amount: BigInt(amount) } });
      else if (result === "over") {
        const error = await run.catch((value: unknown) => value);
        expect(error).toBeInstanceOf(MaxSpendExceededError);
        expect(error).toMatchObject({ code: "E_LIMIT_EXCEEDED", exitCode: 4 });
      } else
        await expect(run).rejects.toMatchObject({
          code: "E_LIMIT_EXCEEDED",
          exitCode: 4,
          message: expect.stringContaining("--max-spend cannot cap a payment in"),
        });
    },
  );

  it("plans an offer that names no chain on the request network", async () => {
    const plan = await checkCharge(
      charge({ currency: pathUsd }),
      options({ network: "testnet", maxSpend: "1" }),
    );
    expect(plan.requirement).toMatchObject({ network: "eip155:42431", asset: pathUsd });
  });

  it.each([
    { name: "a subscription", challenge: charge({ amount: "99000000" }, "subscription") },
    { name: "a zero-amount proof", challenge: charge({ amount: "0", currency: unlistedToken }) },
  ])("leaves $name uncapped", ({ challenge }) => {
    expect(chargePolicy(challenge, { network: mainnet, maxSpend: "1" })).toEqual({});
  });

  it("caps every listed USD token on the network at the cap, and nothing else", () => {
    const assets = maxPaymentAssets({ network: mainnet, maxSpend: "2.5" });
    const listed = assets.map(({ asset }) => asset.toLowerCase());
    expect(
      assets.every(({ network, amount }) => network === "eip155:4217" && amount === 2_500_000n),
    ).toBe(true);
    expect(listed).toContain(usdc.toLowerCase());
    expect(listed).toContain(pathUsd);
    // MACH, EUR, and yield tokens are not USD tokens.
    expect(listed).not.toContain(machineTokenDeployments[4217].token.toLowerCase());
    expect(listed).not.toContain("0x20c0000000000000000000001621e21f71cf12fb");
    expect(listed).not.toContain("0x20c000000000000000000000048c8f36df1c9a4a");
  });

  it("caps testnet's USD tokens on testnet", () => {
    expect(tempoUsdTokens(testnet.chainId).map((token) => token.toLowerCase())).toEqual(
      expect.arrayContaining([pathUsd, "0x20c0000000000000000000009e8d7eb59b783726"]),
    );
  });

  it("adds TEMPO_DEV_CHAINS tokens to the capped tokens of their chain", () => {
    vi.stubEnv(
      "TEMPO_DEV_CHAINS",
      JSON.stringify({ tempo: { "42431": { usdTokens: [unlistedToken] } } }),
    );
    expect(tempoUsdTokens(42431).map((token) => token.toLowerCase())).toContain(unlistedToken);
    expect(tempoUsdTokens(4217).map((token) => token.toLowerCase())).not.toContain(unlistedToken);
  });

  it.each([
    { value: "not json", message: "TEMPO_DEV_CHAINS must be JSON" },
    {
      value: JSON.stringify({ tempo: { "42431": { usdTokens: ["0x1234"] } } }),
      message: "TEMPO_DEV_CHAINS is invalid: tempo.42431.usdTokens.0 must be a 0x address",
    },
  ])("refuses TEMPO_DEV_CHAINS $value", ({ value, message }) => {
    vi.stubEnv("TEMPO_DEV_CHAINS", value);
    expect(() => tempoUsdTokens(42431)).toThrow(
      expect.objectContaining({ code: "E_USAGE", message }),
    );
  });
});
