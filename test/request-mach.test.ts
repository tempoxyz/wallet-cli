import { createServer } from "node:http";
import { Challenge, Credential } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { decodeFunctionData, parseAbi } from "viem";
import {
  call,
  prepareTransactionRequest,
  readContract,
  sendTransactionSync,
  signTransaction,
} from "viem/actions";
import { Abis } from "viem/tempo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRequestArgs, preparePaymentChallenge, runRequest } from "../src/commands/request.js";
import { transferCredits, transferMach } from "../src/commands/transfer.js";
import { usdcToken } from "../src/shared/constants.js";

vi.mock("viem/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/actions")>();
  return {
    ...actual,
    readContract: vi.fn(),
    call: vi.fn(),
    prepareTransactionRequest: vi.fn(),
    signTransaction: vi.fn(),
    sendTransactionSync: vi.fn(),
  };
});
vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: {
        ...actual.Actions.token,
        getBalance: Object.assign(
          vi.fn().mockResolvedValue({ amount: 1_000_000n }),
          actual.Actions.token.getBalance,
        ),
      },
      fee: { ...actual.Actions.fee, getUserToken: vi.fn().mockResolvedValue(undefined) },
    },
  };
});

const deployment = machineTokenDeployments[4217];
const recipient = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;
const servers: ReturnType<typeof createServer>[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external request in MACH test");
    }),
  );
  vi.stubEnv("TEMPO_PRIVATE_KEY", `0x${"1".repeat(64)}`);
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.mocked(readContract).mockResolvedValue(1_000_000n);
  vi.mocked(call).mockResolvedValue({ data: "0x" });
  vi.mocked(prepareTransactionRequest).mockImplementation(
    async (_client, parameters) => ({ ...parameters, gas: 10_000n }) as never,
  );
  vi.mocked(signTransaction).mockResolvedValue("0x021234");
  vi.mocked(sendTransactionSync).mockResolvedValue({ transactionHash: hash } as never);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

function offer(
  requestOverrides: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return Challenge.from({
    id: "mach-offer",
    realm: "local",
    method: "tempo",
    intent: "charge",
    request: {
      amount: "15000",
      currency: usdcToken,
      recipient,
      methodDetails: { chainId: 4217, machineTokenEnabled: true },
      ...requestOverrides,
    },
    ...overrides,
  });
}
function validate(challenges = [offer()], flags: string[] = []) {
  const options = parseRequestArgs([
    "--payment-token",
    "MACH",
    "--max-spend",
    "0.015",
    ...flags,
    "https://example.com",
  ]);
  return preparePaymentChallenge(
    new Response(null, {
      status: 402,
      headers: {
        "www-authenticate": challenges
          .map((challenge) => Challenge.serialize(challenge))
          .join(", "),
        "payment-required": "untrusted-alternative",
      },
    }),
    options,
    options.url,
  );
}
async function server(challenges = [offer()]) {
  const paid: string[] = [];
  const service = createServer((request, response) => {
    if (request.headers.authorization) {
      paid.push(request.headers.authorization);
      response.end("paid");
    } else {
      response.writeHead(402, {
        "www-authenticate": challenges
          .map((challenge) => Challenge.serialize(challenge))
          .join(", "),
        "payment-required": "untrusted-alternative",
      });
      response.end("payment required");
    }
  });
  servers.push(service);
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address();
  if (!address || typeof address === "string") throw new Error("Expected address");
  return { paid, url: `http://127.0.0.1:${address.port}` };
}

it.each(["mach", "MACH", deployment.token])("accepts explicit MACH selection %s", (token) => {
  const options = parseRequestArgs(["--payment-token", token, "https://example.com"]);
  expect(options.paymentToken).toBe(token.toLowerCase() === "mach" ? "MACH" : token.toLowerCase());
});
it("accepts the concise MACH flag and rejects conflicting selectors", () => {
  expect(parseRequestArgs(["--mach", "https://example.com"]).paymentToken).toBe("MACH");
  for (const flags of [
    ["--mach", "--payment-token", usdcToken],
    ["--payment-token", usdcToken, "--mach"],
  ])
    expect(() => parseRequestArgs([...flags, "https://example.com"])).toThrow("conflicts");
});
it("requires a budget before explicit MACH payment, but allows inspection", () => {
  const options = parseRequestArgs(["--mach", "https://example.com"]);
  const response = new Response(null, {
    status: 402,
    headers: { "www-authenticate": Challenge.serialize(offer()) },
  });
  expect(() => preparePaymentChallenge(response, options, options.url)).toThrow(
    "require --max-spend",
  );
  expect(() =>
    preparePaymentChallenge(response, { ...options, dryRun: true }, options.url),
  ).not.toThrow();
  expect(signTransaction).not.toHaveBeenCalled();
});
it("rejects MACH sessions before requests", () => {
  expect(() =>
    parseRequestArgs([
      "--payment-token",
      "MACH",
      "--payment-intent",
      "session",
      "https://example.com",
    ]),
  ).toThrow("supports charge payments");
});
it("selects one exact capped MACH-enabled settlement offer without changing its signed request", () => {
  const selected = offer();
  const { challenge, response } = validate([
    offer({}, { intent: "session", id: "session" }),
    selected,
    offer({ amount: "999999" }, { id: "expensive" }),
  ]);
  expect(challenge).toEqual(selected);
  expect(Challenge.deserializeList(response.headers.get("www-authenticate")!)).toEqual([selected]);
  expect(challenge.request.currency).toBe(usdcToken);
});
it.each([
  ["cap", { amount: "15001" }, {}, "max spend exceeded"],
  ["malformed amount", { amount: "-1" }, {}, "valid amount"],
  [
    "chain",
    { methodDetails: { chainId: 42431, machineTokenEnabled: true } },
    {},
    "network mismatch",
  ],
  ["recipient", { recipient: "invalid" }, {}, "valid recipient"],
  ["direct MACH", { currency: deployment.token }, {}, "not advertised"],
  ["expired", {}, { expires: "2000-01-01T00:00:00Z" }, "expired"],
  [
    "split",
    {
      methodDetails: {
        chainId: 4217,
        machineTokenEnabled: true,
        splits: [{ amount: "1", recipient }],
      },
    },
    {},
    "split charge",
  ],
  ["disabled MACH", { methodDetails: { chainId: 4217 } }, {}, "did not offer payment token"],
] as const)("rejects %s before signing", (_name, request, fields, error) => {
  expect(() => validate([offer(request, fields)])).toThrow(error);
  expect(prepareTransactionRequest).not.toHaveBeenCalled();
  expect(sendTransactionSync).not.toHaveBeenCalled();
});
it("runs the actual SDK MACH route and sends only the validated credential", async () => {
  const selected = offer();
  const service = await server([selected, offer({ amount: "999999" }, { id: "expensive" })]);
  const chunks: string[] = [];
  await runRequest(["--mach", "--max-spend", "0.015", service.url], {
    stdout: {
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
    },
  });
  expect(chunks.join("")).toBe("paid");
  expect(service.paid).toHaveLength(1);
  expect(Credential.deserialize(service.paid[0]!).challenge).toEqual(selected);
  const parameters = vi.mocked(prepareTransactionRequest).mock.calls[0]![1] as unknown as {
    calls: { to: string; data: `0x${string}` }[];
  };
  const calls = parameters.calls!;
  expect(calls.map((item) => item.to)).toEqual([deployment.token, deployment.swap]);
  expect(decodeFunctionData({ abi: Abis.tip20, data: calls[0]!.data! })).toMatchObject({
    functionName: "approve",
    args: [deployment.swap, 15000n],
  });
  const swap = decodeFunctionData({
    abi: parseAbi([
      "function swapTo(address inputToken,uint256 amount,address targetToken,address recipient,bytes32 memo)",
    ]),
    data: calls[1]!.data!,
  });
  expect(swap.args.slice(0, 4)).toEqual([
    deployment.token,
    15000n,
    expect.stringMatching(new RegExp(`^${usdcToken}$`, "i")),
    recipient,
  ]);
  expect(signTransaction).toHaveBeenCalledOnce();
  expect(sendTransactionSync).not.toHaveBeenCalled();
});
it.each(["balance", "simulation"])(
  "does not spend stablecoins when explicit MACH %s is unavailable",
  async (failure) => {
    if (failure === "balance") vi.mocked(readContract).mockResolvedValue(0n);
    else vi.mocked(call).mockRejectedValue(new Error("unavailable"));
    const service = await server();
    await expect(
      runRequest(["--payment-token", "MACH", "--max-spend", "0.015", service.url]),
    ).rejects.toThrow("no stablecoin fallback");
    expect(service.paid).toEqual([]);
    expect(signTransaction).not.toHaveBeenCalled();
    expect(sendTransactionSync).not.toHaveBeenCalled();
  },
);
it("uses MACH automatically for an ordinary machine-enabled charge", async () => {
  const service = await server();
  await runRequest(["--max-spend", "0.015", service.url], {
    stdout: {
      write() {
        return true;
      },
    },
  });
  expect(
    sdkCalls(vi.mocked(prepareTransactionRequest).mock.calls[0]![1]).map((item) => item.to),
  ).toEqual([deployment.token, deployment.swap]);
});

describe("transferMach", () => {
  it("keeps credits as a compatibility alias", () => expect(transferCredits).toBe(transferMach));
  it("inspects a standalone challenge without a budget or wallet access", async () => {
    const result = await transferMach({
      options: { "dry-run": true, "mpp-challenge": Challenge.serialize(offer()) },
    });
    expect(result).toMatchObject({ dry_run: true, amount_raw: "15000", token: "MACH" });
    expect(readContract).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(sendTransactionSync).not.toHaveBeenCalled();
  });
  it("supports sub-cent MACH amounts in dry-run without signing", async () => {
    const result = await transferMach({
      options: {
        "dry-run": true,
        "mpp-challenge": Challenge.serialize(offer()),
        "max-spend": "0.015",
      },
    });
    expect(result).toMatchObject({
      dry_run: true,
      amount: "0.015",
      amount_raw: "15000",
      token: "MACH",
      settlement_currency: usdcToken,
    });
    expect(readContract).not.toHaveBeenCalled();
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it.each([{ to: recipient, "amount-cents": 1 }, { data: "0x1234" }, { value: "0" }])(
    "rejects unsupported direct transfer flags",
    async (flags) => {
      await expect(transferCredits({ options: { ...flags, "dry-run": true } })).rejects.toThrow(
        "does not support direct calldata",
      );
    },
  );
  it("requires an explicit cap for standalone challenge settlement", async () => {
    await expect(
      transferMach({ options: { "mpp-challenge": Challenge.serialize(offer()) } }),
    ).rejects.toThrow("requires --max-spend");
  });
  it("treats legacy cents as a cap instead of rounding the payment", async () => {
    const options = { "dry-run": true, "mpp-challenge": Challenge.serialize(offer()) };
    await expect(transferCredits({ options: { ...options, "amount-cents": 1 } })).rejects.toThrow(
      "max spend exceeded",
    );
    expect(await transferCredits({ options: { ...options, "amount-cents": 2 } })).toMatchObject({
      amount_raw: "15000",
      max_spend: "0.02",
    });
  });
  it("settles using the actual SDK in push mode and returns the receipt hash", async () => {
    const result = await transferMach({
      options: { "mpp-challenge": Challenge.serialize(offer()), "max-spend": "0.015" },
    });
    expect(result).toMatchObject({ tx_hash: hash, token: "MACH", amount_raw: "15000" });
    expect(
      sdkCalls(vi.mocked(sendTransactionSync).mock.calls[0]![1]).map((item) => item.to),
    ).toEqual([deployment.token, deployment.swap]);
    expect(sendTransactionSync).toHaveBeenCalledOnce();
  });
  it("reports an uncertain settlement once without retry or leaked error details", async () => {
    vi.mocked(sendTransactionSync).mockRejectedValue(new Error("sensitive-provider-payload"));
    await expect(
      transferMach({
        options: { "mpp-challenge": Challenge.serialize(offer()), "max-spend": "0.015" },
      }),
    ).rejects.toMatchObject({ code: "E_PAYMENT_OUTCOME_UNKNOWN" });
    expect(sendTransactionSync).toHaveBeenCalledOnce();
  });
});

function sdkCalls(parameters: unknown) {
  return (parameters as { calls: { to: string; data: `0x${string}` }[] }).calls;
}
