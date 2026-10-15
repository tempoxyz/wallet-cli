import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { txStatus } from "../src/commands/tx.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { parseNetwork } from "../src/shared/network.js";
import { nowSeconds } from "../src/shared/utils.js";
import { createIdempotencyRecord } from "../src/wallet/idempotency.js";
import { cliBundle } from "./cli-bundle.js";
import { testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";

const hash = `0x${"ab".repeat(32)}`;
const sender = testWallet.toLowerCase();
const recipient = "0x1111111111111111111111111111111111111111";

/** RPC results by method; a missing method answers with a JSON-RPC error. */
let results: Record<string, unknown> = {};
let methods: string[] = [];
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      methods.push(method);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          method in results
            ? { jsonrpc: "2.0", id, result: results[method] }
            : { jsonrpc: "2.0", id, error: { code: -32603, message: "node unavailable" } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  results = {};
  methods = [];
  vi.stubEnv("TEMPO_RPC_URL", url);
});

function receipt(status: string) {
  return {
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: "0x2a",
    contractAddress: null,
    cumulativeGasUsed: "0x5208",
    // 21000 gas at 2e10 attodollars each is 420 fee-token base units.
    effectiveGasPrice: "0x4a817c800",
    feeToken: usdcToken,
    from: sender,
    gasUsed: "0x5208",
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status,
    to: recipient,
    transactionHash: hash,
    transactionIndex: "0x0",
    type: "0x2",
  };
}

const pendingTransaction = {
  accessList: [],
  blockHash: null,
  blockNumber: null,
  chainId: "0x1079",
  from: sender,
  gas: "0x5208",
  hash,
  input: "0x",
  maxFeePerGas: "0x4a817c800",
  maxPriorityFeePerGas: "0x0",
  nonce: "0x1",
  r: `0x${"22".repeat(32)}`,
  s: `0x${"33".repeat(32)}`,
  to: recipient,
  transactionIndex: null,
  type: "0x2",
  v: "0x0",
  value: "0x0",
  yParity: "0x0",
};

const unincluded = { block_number: null, from: null, to: null, fee: null, fee_token: null };

describe("txStatus", () => {
  it.each([
    {
      status: "success",
      rpc: { eth_getTransactionReceipt: receipt("0x1") },
      expected: {
        block_number: 42,
        from: sender,
        to: recipient,
        fee: "0.00042",
        fee_token: usdcToken,
      },
      methods: ["eth_getTransactionReceipt"],
    },
    {
      status: "reverted",
      rpc: { eth_getTransactionReceipt: receipt("0x0") },
      expected: {
        block_number: 42,
        from: sender,
        to: recipient,
        fee: "0.00042",
        fee_token: usdcToken,
      },
      methods: ["eth_getTransactionReceipt"],
    },
    {
      status: "pending",
      rpc: { eth_getTransactionReceipt: null, eth_getTransactionByHash: pendingTransaction },
      expected: {
        ...unincluded,
        from: sender,
        to: recipient,
        instruction:
          "The transaction is pending. Rerun the next command until its status is no longer pending.",
        _next: {
          argv: ["tempo", "wallet", "tx", "status", hash, "--network", "mainnet"],
          command: `tempo wallet tx status ${hash} --network mainnet`,
          until: '.status != "pending"',
          poll_interval_seconds: 1,
        },
      },
      methods: ["eth_getTransactionReceipt", "eth_getTransactionByHash"],
    },
    {
      status: "not_found",
      rpc: { eth_getTransactionReceipt: null, eth_getTransactionByHash: null },
      expected: unincluded,
      methods: ["eth_getTransactionReceipt", "eth_getTransactionByHash"],
    },
  ])("reports a $status transaction", async ({ status, rpc, expected, methods: called }) => {
    results = rpc;

    expect(await txStatus(hash.toUpperCase().replace("0X", "0x"), parseNetwork("mainnet"))).toEqual(
      {
        tx_hash: hash,
        chain_id: 4217,
        network: "tempo",
        status,
        ...expected,
      },
    );
    expect(methods).toEqual(called);
  });

  it.each([
    { name: "the receipt read", rpc: {} },
    { name: "the pending transaction read", rpc: { eth_getTransactionReceipt: null } },
  ])("fails with a retryable E_NETWORK when $name fails", async ({ rpc }) => {
    results = rpc;

    await expect(txStatus(hash, parseNetwork("testnet"))).rejects.toMatchObject({
      code: "E_NETWORK",
      retryable: true,
      message: expect.stringContaining(`Unable to read transaction ${hash} on testnet: `),
    });
  });

  it.each(["0x1234", `${hash}00`, hash.slice(2), `0x${"zz".repeat(32)}`])(
    "rejects the hash %j without reading the chain",
    async (input) => {
      await expect(txStatus(input, parseNetwork("mainnet"))).rejects.toMatchObject({
        code: "E_USAGE",
        message: "Invalid transaction hash: expected 0x followed by 64 hex characters",
      });
      expect(methods).toEqual([]);
    },
  );
});

describe("tempo wallet tx status", () => {
  it.each([
    { args: ["--network", "testnet"], chainId: 42431, network: "tempo-moderato" },
    { args: [], chainId: 4217, network: "tempo" },
  ])("reads the receipt on the resolved network ($args)", async ({ args, chainId, network }) => {
    const home = await useTempHome();
    results = { eth_getTransactionReceipt: receipt("0x1") };

    const result = await walletCli(["tx", "status", hash, ...args], home);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      tx_hash: hash,
      chain_id: chainId,
      network,
      status: "success",
    });
  });

  it.each([
    { tx_hash: null, command: "tempo wallet whoami --network mainnet" },
    { tx_hash: hash, command: `tempo wallet tx status ${hash} --network mainnet` },
  ])(
    "returns a transfer's unknown outcome with its cta (recorded hash: $tx_hash)",
    async ({ tx_hash, command }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      // A transfer that stopped after claiming its key.
      await createIdempotencyRecord({
        key: "k1",
        wallet: sender,
        chain_id: 4217,
        request: {
          command: "transfer",
          amount: "1000000",
          token: moderatoToken,
          to: recipient,
          fee_token: null,
        },
        status: "submitting",
        tx_hash,
        created_at: nowSeconds(),
        result: null,
      });

      const result = await walletCli(
        ["transfer", "1", "pathUSD", recipient, "--yes", "--idempotency-key", "k1"],
        home,
      );

      expect(result.code).toBe(4);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "E_PAYMENT_OUTCOME_UNKNOWN",
        message: expect.stringContaining(tx_hash ?? "Check the wallet balance"),
        cta: { commands: [{ command }] },
      });
      expect(methods).toEqual([]);
    },
  );

  it("refuses --idempotency-key outside token transfers", async () => {
    const home = await useTempHome();

    const result = await walletCli(
      ["transfer", "--mach", "--max-spend", "1", "--mpp-challenge", "x", "--idempotency-key", "k1"],
      home,
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toContain("--idempotency-key applies only to token transfers");
    expect(methods).toEqual([]);
  });
});

describe("keyed agent sends with an expired access key", () => {
  const sends = {
    transfer: {
      argv: ["transfer", "1", "pathUSD", recipient, "--yes", "--idempotency-key", "k1"],
      request: {
        command: "transfer",
        amount: "1000000",
        token: moderatoToken,
        to: recipient,
        fee_token: null,
      },
    },
    swap: {
      argv: ["swap", "1", "pathUSD", "USDC.e", "--yes", "--idempotency-key", "k1"],
      request: {
        command: "swap",
        mode: "exact_in",
        amount: "1000000",
        token_in: moderatoToken,
        token_out: usdcToken,
        fee_token: moderatoToken,
      },
    },
  };
  const refresh = "tempo wallet refresh --network mainnet";
  const refused = {
    code: "E_KEY_EXPIRED",
    message: `The access key for this wallet on mainnet has expired. Run '${refresh}' before retrying.`,
    cta: { commands: [{ command: refresh }] },
  };

  it.each([
    { command: "transfer", recorded: true, dryRun: false },
    { command: "swap", recorded: true, dryRun: false },
    { command: "transfer", recorded: false, dryRun: false },
    { command: "swap", recorded: false, dryRun: false },
    { command: "transfer", recorded: false, dryRun: true },
    { command: "swap", recorded: false, dryRun: true },
  ] as const)(
    "$command replays a recorded send but refuses to sign (recorded: $recorded, dry run: $dryRun)",
    async ({ command, recorded, dryRun }) => {
      const home = await useTempHome();
      const key = { ...walletState().accessKeys[0]!, expiry: 1 };
      await writeWalletState(walletState({ accessKeys: [key] }));
      const { argv, request } = sends[command];
      if (recorded)
        await createIdempotencyRecord({
          key: "k1",
          wallet: sender,
          chain_id: 4217,
          request,
          status: "success",
          tx_hash: hash,
          created_at: nowSeconds(),
          result: { status: "success", tx_hash: hash, chain_id: 4217, network: "tempo" },
        });
      results = { eth_getTransactionReceipt: receipt("0x1") };

      const result = await walletCli(
        dryRun ? [...argv.filter((arg) => arg !== "--yes"), "--dry-run"] : [...argv],
        home,
      );

      expect(result.code).toBe(recorded ? 0 : 4);
      expect(JSON.parse(result.stdout)).toMatchObject(
        recorded ? { status: "success", tx_hash: hash, idempotent_replay: true } : refused,
      );
      expect(methods).toEqual(recorded ? ["eth_getTransactionReceipt"] : []);
      const records = await readdir(join(home, ".tempo", "wallet", "idempotency")).catch(() => []);
      expect(records.filter((name) => name.endsWith(".json"))).toHaveLength(recorded ? 1 : 0);
    },
  );
});

function walletCli(args: string[], home: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    NO_COLOR: "1",
    TEMPO_RPC_URL: url,
  };
  delete env.TEMPO_WALLET_NETWORK;
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [cliBundle("wallet"), ...args, "--format", "json"],
      { env, timeout: 20_000 },
      (error, stdout) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout });
      },
    );
  });
}
