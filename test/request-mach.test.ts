import { createServer } from "node:http";
import { Errors } from "incur";
import { Challenge, Credential } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { decodeFunctionData, parseAbi, TimeoutError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  call,
  prepareTransactionRequest,
  readContract,
  sendTransactionSync,
  signTransaction,
} from "viem/actions";
import { Abis, Actions } from "viem/tempo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRequestArgs } from "../src/request/args.js";
import { preparePaymentChallenge } from "../src/request/challenge.js";
import { runRequest } from "../src/request/run.js";
import { transferMach } from "../src/commands/transfer/mach.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { CtaError } from "../src/shared/errors.js";
import {
  testAccessKey,
  unlistedToken,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

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
        getMetadata: vi.fn(),
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
  // An unlisted token's metadata is read on chain; these tests have no RPC.
  vi.mocked(Actions.token.getMetadata).mockRejectedValue(new Error("no RPC in MACH tests"));
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

const payer = privateKeyToAccount(`0x${"1".repeat(64)}`).address.toLowerCase();
const noFallback = "No stablecoin fallback was authorized.";
const fundMach = `tempo wallet fund --mach --address ${payer} --network mainnet`;
const raiseMachLimit = `tempo wallet keys update ${testAccessKey} --token ${deployment.token.toLowerCase()} --limit 0.015 --network mainnet`;
const storedKey = walletState().accessKeys[0]!;

type MachRouteFailure = {
  cause: string;
  network?: "testnet";
  /** Pays with the logged-in wallet's access key, changed by these fields, not TEMPO_PRIVATE_KEY. */
  stored?: Partial<typeof storedKey>;
  /** The MACH balance read, or its failure. */
  balance?: bigint | Error;
  /** The route simulation's failure; `once` fails only the SDK's attempt, not the re-check. */
  simulation?: { error: Error; once?: true };
  /** Decided from the stored key, without an RPC read. */
  offline?: true;
  error: Record<string, unknown>;
  cta?: string;
};

const machLimit = { limits: [{ token: deployment.token, limit: "15000#__bigint" }] };
const scopeRefusal = (contract: "token" | "swapper", address: string) =>
  `MACH settlement is unavailable: the access key's call scopes do not allow its call to the MACH ${contract} (${address.toLowerCase()}), and 'tempo wallet keys update' cannot change call scopes; the wallet owner must authorize a key that may make that call. ${noFallback}`;
const unsimulated = (causes: string, retry = "") =>
  `MACH settlement is unavailable: the MACH swap route for 0.015 MACH could not be simulated. Possible causes: ${causes}.${retry} ${noFallback}`;

// Each cause of an unavailable MACH route, and the error and `cta` it reports.
const machRouteFailures: MachRouteFailure[] = [
  {
    cause: "an access key whose MACH limit is below the charge",
    stored: { limits: [{ token: deployment.token, limit: "1000#__bigint" }] },
    offline: true,
    error: {
      code: "E_LIMIT_EXCEEDED",
      exitCode: 4,
      retryable: false,
      message: `The access key cannot spend 0.015 MACH. Ask the wallet owner to run '${raiseMachLimit}', then retry.`,
    },
    cta: raiseMachLimit,
  },
  {
    cause: "exact access-key limits that leave MACH out",
    stored: { permissionSemantics: 1 },
    offline: true,
    error: {
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining("cannot spend 0.015 MACH"),
    },
    cta: raiseMachLimit,
  },
  {
    cause: "exact call scopes that leave the swapper out",
    stored: { ...machLimit, permissionSemantics: 1, scopes: [{ address: deployment.token }] },
    offline: true,
    error: {
      code: "E_PAYMENT",
      exitCode: 4,
      retryable: false,
      message: scopeRefusal("swapper", deployment.swap),
    },
  },
  {
    cause: "exact call scopes that allow another MACH token selector",
    stored: {
      ...machLimit,
      permissionSemantics: 1,
      scopes: [{ address: deployment.token, selector: "0xa9059cbb" }, { address: deployment.swap }],
    },
    offline: true,
    error: { code: "E_PAYMENT", message: scopeRefusal("token", deployment.token) },
  },
  {
    cause: "a MACH balance below the charge",
    balance: 10_000n,
    error: {
      code: "E_INSUFFICIENT_FUNDS",
      exitCode: 4,
      retryable: false,
      message: `The MACH balance 0.01 is below the 0.015 MACH this charge needs. Buy MACH with '${fundMach}', then retry. ${noFallback}`,
    },
    cta: fundMach,
  },
  {
    cause: "a testnet MACH balance below the charge",
    network: "testnet",
    balance: 0n,
    error: {
      code: "E_INSUFFICIENT_FUNDS",
      message: `The MACH balance 0 is below the 0.015 MACH this charge needs. MACH can be bought on mainnet only. ${noFallback}`,
    },
  },
  {
    cause: "a route simulation that reverts",
    simulation: { error: new Error("swapper reverted") },
    error: {
      code: "E_PAYMENT",
      exitCode: 4,
      retryable: false,
      message: unsimulated("insufficient swapper liquidity or a transient RPC error"),
    },
  },
  {
    cause: "a route simulation that reverts for an access key",
    stored: machLimit,
    simulation: { error: new Error("swapper reverted") },
    error: {
      code: "E_PAYMENT",
      retryable: false,
      message: unsimulated(
        "insufficient swapper liquidity, the access key's call scopes, or a transient RPC error",
      ),
    },
  },
  {
    cause: "a route simulation that times out",
    simulation: { error: new TimeoutError({ body: {}, url: "https://rpc.example" }) },
    error: {
      code: "E_PAYMENT",
      retryable: true,
      message: unsimulated(
        "insufficient swapper liquidity or a transient RPC error",
        " Try again shortly.",
      ),
    },
  },
  {
    cause: "a route simulation that fails only once",
    simulation: { error: new Error("swapper reverted"), once: true },
    error: { code: "E_PAYMENT", retryable: true, message: expect.stringContaining("Try again") },
  },
  {
    cause: "a MACH balance that cannot be read",
    balance: new Error("rpc down"),
    error: {
      code: "E_NETWORK",
      exitCode: 3,
      retryable: true,
      message: `MACH settlement is unavailable: the MACH balance could not be read. Check RPC connectivity (TEMPO_RPC_URL). ${noFallback}`,
    },
  },
];

describe.each([
  {
    via: "tempo request --mach",
    pay: async (network: string) => {
      const testnet = network === "testnet";
      const service = await server([
        offer({
          ...(testnet ? { currency: moderatoToken } : {}),
          methodDetails: { chainId: testnet ? 42431 : 4217, machineTokenEnabled: true },
        }),
      ]);
      const error = await runRequest(["-n", network, "--mach", "--max-spend", "0.015", service.url])
        .then(() => undefined)
        .catch((value: unknown) => value);
      expect(service.paid).toEqual([]);
      return error;
    },
  },
  {
    via: "tempo wallet transfer --mach",
    pay: async (network: string) => {
      const testnet = network === "testnet";
      const challenge = offer({
        ...(testnet ? { currency: moderatoToken } : {}),
        methodDetails: { chainId: testnet ? 42431 : 4217, machineTokenEnabled: true },
      });
      return transferMach({
        options: { network, "mpp-challenge": Challenge.serialize(challenge), "max-spend": "0.015" },
      }).catch((value: unknown) => value);
    },
  },
])("an unavailable MACH route through $via", ({ pay }) => {
  it.each(machRouteFailures)(
    "reports $cause without signing",
    async ({ network = "mainnet", stored, balance, simulation, offline, error: expected, cta }) => {
      if (stored) {
        await useTempHome();
        await writeWalletState(walletState({ accessKeys: [{ ...storedKey, ...stored }] }));
        vi.stubEnv("TEMPO_PRIVATE_KEY", "");
      }
      if (typeof balance === "bigint") vi.mocked(readContract).mockResolvedValue(balance);
      else if (balance) vi.mocked(readContract).mockRejectedValue(balance);
      if (simulation?.once) vi.mocked(call).mockRejectedValueOnce(simulation.error);
      else if (simulation) vi.mocked(call).mockRejectedValue(simulation.error);

      const error = await pay(network);

      expect(error).toBeInstanceOf(Errors.IncurError);
      expect(error).toMatchObject(expected);
      expect((error as Partial<CtaError>).payload?.cta).toEqual(
        cta ? { commands: [{ command: cta }] } : undefined,
      );
      if (offline) {
        expect(readContract).not.toHaveBeenCalled();
        expect(call).not.toHaveBeenCalled();
      }
      expect(prepareTransactionRequest).not.toHaveBeenCalled();
      expect(signTransaction).not.toHaveBeenCalled();
      expect(sendTransactionSync).not.toHaveBeenCalled();
    },
  );
});

it.each([
  { name: "a MACH limit that covers the charge", stored: machLimit },
  {
    name: "exact call scopes that allow the route",
    stored: {
      ...machLimit,
      permissionSemantics: 1 as const,
      scopes: [{ address: deployment.token, selector: "0x095ea7b3" }, { address: deployment.swap }],
    },
  },
])("pays MACH with an access key that has $name", async ({ stored }) => {
  await useTempHome();
  await writeWalletState(walletState({ accessKeys: [{ ...storedKey, ...stored }] }));
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  const service = await server();

  await runRequest(["--mach", "--max-spend", "0.015", service.url], {
    stdout: { write: () => true },
  });

  expect(service.paid).toHaveLength(1);
  expect(signTransaction).toHaveBeenCalledOnce();
});

// The SDK refuses a credential the key's limit cannot cover; the cta raises the limit of the
// token the signed calls debit, which is MACH whenever the SDK took the MACH route, to the charge
// in that token's decimals.
it.each([
  {
    route: "the direct transfer",
    request: { methodDetails: { chainId: 4217 } },
    token: usdcToken,
    label: "USDC.e",
    limit: "0.015",
  },
  {
    route: "the MACH route",
    request: { methodDetails: { chainId: 4217, machineTokenEnabled: true } },
    token: deployment.token.toLowerCase(),
    label: "MACH",
    limit: "0.015",
  },
  {
    route: "a direct transfer of an 18-decimal token",
    request: { currency: unlistedToken, methodDetails: { chainId: 4217 } },
    metadata: { decimals: 18, symbol: "WIDE" },
    token: unlistedToken,
    label: "WIDE",
    limit: "0.000000000000015",
  },
])(
  "names the token $route debits when the access key's limit refuses a charge",
  async ({ request, metadata, token, label, limit }) => {
    await useTempHome();
    await writeWalletState(walletState());
    vi.stubEnv("TEMPO_PRIVATE_KEY", "");
    if (metadata) vi.mocked(Actions.token.getMetadata).mockResolvedValue(metadata as never);
    vi.mocked(prepareTransactionRequest).mockRejectedValue(
      new Error("Execution reverted: SpendingLimitExceeded()"),
    );
    const service = await server([offer(request)]);

    const error = await runRequest(["--max-spend", "0.015", service.url]).catch(
      (value: unknown) => value,
    );

    const command = `tempo wallet keys update ${testAccessKey} --token ${token} --limit ${limit} --network mainnet`;
    expect(error).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      exitCode: 4,
      message: `The access key cannot spend ${limit} ${label}. Ask the wallet owner to run '${command}', then retry.`,
      payload: { cta: { commands: [{ command }] } },
    });
    expect(service.paid).toEqual([]);
  },
);

// Without an access key there is no limit to raise, the SDK picks the fee token without exposing
// it, and an unreadable token has no known decimals, so none of these refusals names a keys update.
it.each([
  { name: "no access key pays", key: false, message: "SpendingLimitExceeded()" },
  {
    name: "the fee token's limit refuses it",
    key: true,
    message: "Fee token spending limit exceeded",
  },
  {
    name: "the fee token's limit refuses it (error name)",
    key: true,
    message: "FeeTokenSpendingLimitExceeded()",
  },
  {
    name: "the debited token's decimals cannot be read",
    key: true,
    message: "SpendingLimitExceeded()",
    currency: unlistedToken,
  },
])(
  "reports a spending-limit refusal without a cta when $name",
  async ({ key, message, currency }) => {
    if (key) {
      await useTempHome();
      await writeWalletState(walletState());
      vi.stubEnv("TEMPO_PRIVATE_KEY", "");
    }
    vi.mocked(prepareTransactionRequest).mockRejectedValue(new Error(message));
    const service = await server([
      offer({ ...(currency ? { currency } : {}), methodDetails: { chainId: 4217 } }),
    ]);

    const error = await runRequest(["--max-spend", "0.015", service.url]).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: "E_PAYMENT", message });
    expect(error).not.toBeInstanceOf(CtaError);
    expect(service.paid).toEqual([]);
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

it.each([{ flags: [] }, { flags: ["--mach"] }])(
  "routes testnet MACH settlement through Moderato $flags",
  async ({ flags }) => {
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    const testnetDeployment = machineTokenDeployments[42431];
    const selected = offer({
      currency: moderatoToken,
      methodDetails: { chainId: 42431, machineTokenEnabled: true },
    });
    const service = await server([offer(), selected]);
    await runRequest(["-n", "testnet", ...flags, "--max-spend", "0.015", service.url], {
      stdout: { write: () => true },
    });
    const [client, parameters] = vi.mocked(prepareTransactionRequest).mock.calls[0]!;
    expect(client.chain?.id).toBe(42431);
    expect(client.transport.url).toBe("https://rpc.moderato.tempo.xyz");
    expect(sdkCalls(parameters).map((item) => item.to)).toEqual([
      testnetDeployment.token,
      testnetDeployment.swap,
    ]);
    expect(service.paid).toHaveLength(1);
    expect(Credential.deserialize(service.paid[0]!).challenge).toEqual(selected);
  },
);

describe("transferMach", () => {
  it.each([
    { payer: "TEMPO_PRIVATE_KEY", privateKey: `0x${"1".repeat(64)}`, chain: 4217 },
    { payer: "the logged-in wallet", privateKey: "", chain: 42431 },
  ])("selects chain $chain on a testnet login when $payer pays", async ({ privateKey, chain }) => {
    await useTempHome();
    await writeWalletState(walletState({ chainId: 42431 }));
    vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
    vi.stubEnv("TEMPO_PRIVATE_KEY", privateKey);
    const challenge = offer({
      currency: chain === 42431 ? moderatoToken : usdcToken,
      methodDetails: { chainId: chain, machineTokenEnabled: true },
    });

    const result = await transferMach({
      options: { "dry-run": true, "mpp-challenge": Challenge.serialize(challenge) },
    });

    expect(result).toMatchObject({ dry_run: true, chain_id: chain });
  });
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
      await expect(transferMach({ options: { ...flags, "dry-run": true } })).rejects.toThrow(
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
    await expect(transferMach({ options: { ...options, "amount-cents": 1 } })).rejects.toThrow(
      "max spend exceeded",
    );
    expect(await transferMach({ options: { ...options, "amount-cents": 2 } })).toMatchObject({
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
  it("shows an untrusted challenge ID with visible escapes after an uncertain settlement", async () => {
    vi.mocked(sendTransactionSync).mockRejectedValue(new Error("timeout"));
    await expect(
      transferMach({
        options: {
          "mpp-challenge": Challenge.serialize(offer({}, { id: "mach\u009d\u200b-offer" })),
          "max-spend": "0.015",
        },
      }),
    ).rejects.toMatchObject({
      code: "E_PAYMENT_OUTCOME_UNKNOWN",
      message:
        'MACH settlement did not return a confirmed result. Check challenge "mach\\u009d\\u200b-offer" with the provider before retrying.',
    });
  });
});

function sdkCalls(parameters: unknown) {
  return (parameters as { calls: { to: string; data: `0x${string}` }[] }).calls;
}
