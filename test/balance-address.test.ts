import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

import { encodeQR } from "qr";
import { decodeFunctionData, erc20Abi, toHex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMetadata: vi.fn(
    async (
      _client: unknown,
      _parameters: { token: string },
    ): Promise<{ decimals: number; symbol: string }> => {
      throw new Error("no metadata");
    },
  ),
}));

// Unlisted tokens' metadata is a multicall the loopback RPC does not serve.
vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getMetadata: mocks.getMetadata },
    },
  };
});

import { balanceHandler } from "../src/commands/balance.js";
import { balanceOutput } from "../src/schemas/balance.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { parseNetwork } from "../src/shared/network.js";
import { cliBundle } from "./cli-bundle.js";
import {
  containsSymbol,
  expectTokenError,
  invalidTokenInputs,
  ousdToken,
  readyWallet,
  testnetUsdc,
  testWallet,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const wallet = testWallet.toLowerCase();
const mainnet = { chain_id: 4217, network: "tempo" };
const testnet = { chain_id: 42431, network: "tempo-moderato" };

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.getMetadata.mockReset();
  mocks.getMetadata.mockRejectedValue(new Error("no metadata"));
});

const listed = (token: string, symbol: string, balance: string) => ({
  token,
  symbol,
  decimals: 6,
  balance,
  verified: true,
});

describe("tempo wallet balance", () => {
  it.each([
    {
      name: "mainnet: the wallet app's tokens, then USDC.e read on chain even at zero",
      state: walletState(),
      argv: [],
      onChain: {},
      assets: {
        4217: [
          { address: ousdToken, balance: "1500000", decimals: 6, symbol: "OUSD", verified: true },
          // An unlisted token keeps its own decimals; its symbol is sanitized.
          {
            address: unlistedToken,
            balance: "2500000000000000000",
            decimals: 18,
            symbol: "\u001b[31mNEW​",
            verified: false,
          },
        ],
      },
      expected: {
        ...mainnet,
        balances: [
          listed(ousdToken, "OUSD", "1.5"),
          { token: unlistedToken, symbol: "NEW", decimals: 18, balance: "2.5", verified: false },
          listed(usdcToken, "USDC.e", "0"),
        ],
      },
      requests: [`assets 4217 ${wallet}`, `balanceOf ${usdcToken} ${wallet}`],
    },
    {
      name: "testnet: the wallet app's tokens, then pathUSD read on chain",
      state: walletState({ chainId: 42431, accessKeys: [] }),
      argv: [],
      onChain: { [moderatoToken]: 1_000_004_996_912n },
      assets: {
        42431: [
          {
            address: testnetUsdc,
            balance: "3250000",
            decimals: 6,
            symbol: "USDC.e",
            verified: true,
          },
        ],
      },
      expected: {
        ...testnet,
        balances: [
          listed(testnetUsdc, "USDC.e", "3.25"),
          listed(moderatoToken, "pathUSD", "1000004.996912"),
        ],
      },
      requests: [`assets 42431 ${wallet}`, `balanceOf ${moderatoToken} ${wallet}`],
    },
    {
      name: "testnet by --network over a mainnet login",
      state: walletState(),
      argv: ["--network", "testnet"],
      onChain: { [moderatoToken]: 2_000_000n },
      assets: {},
      expected: { ...testnet, balances: [listed(moderatoToken, "pathUSD", "2")] },
      requests: [`assets 42431 ${wallet}`, `balanceOf ${moderatoToken} ${wallet}`],
    },
    {
      name: "the wallet app's balance of the default token over the chain's",
      state: walletState(),
      argv: [],
      onChain: { [usdcToken]: 1n },
      assets: {
        4217: [
          { address: usdcToken, balance: "7000000", decimals: 6, symbol: "USDC.e", verified: true },
        ],
      },
      expected: { ...mainnet, balances: [listed(usdcToken, "USDC.e", "7")] },
      requests: [`assets 4217 ${wallet}`, `balanceOf ${usdcToken} ${wallet}`],
    },
    {
      name: "the wallet app's balance of the default token when the chain cannot be read",
      state: walletState(),
      argv: [],
      onChain: {},
      assets: {
        4217: [
          { address: usdcToken, balance: "7000000", decimals: 6, symbol: "USDC.e", verified: true },
        ],
      },
      failRpc: true,
      expected: { ...mainnet, balances: [listed(usdcToken, "USDC.e", "7")] },
      requests: [`assets 4217 ${wallet}`, "POST / eth_call"],
    },
    {
      name: "--token by symbol, read on chain only",
      state: walletState(),
      argv: ["--token", "USDC"],
      onChain: { [usdcToken]: 5_000_000n, [ousdToken]: 1n },
      assets: {
        4217: [{ address: ousdToken, balance: "1", decimals: 6, symbol: "OUSD", verified: true }],
      },
      expected: { ...mainnet, balances: [listed(usdcToken, "USDC.e", "5")] },
      requests: [`balanceOf ${usdcToken} ${wallet}`],
    },
    {
      name: "--token by symbol on testnet",
      state: walletState({ chainId: 42431, accessKeys: [] }),
      argv: ["--token", "pathusd"],
      onChain: { [moderatoToken]: 1_250_000n },
      assets: {},
      expected: { ...testnet, balances: [listed(moderatoToken, "pathUSD", "1.25")] },
      requests: [`balanceOf ${moderatoToken} ${wallet}`],
    },
    {
      name: "--token by checksummed address",
      state: walletState(),
      argv: ["--token", "0x20C000000000000000000000b9537d11c60E8b50"],
      onChain: { [usdcToken]: 10_000_001n },
      assets: {},
      expected: { ...mainnet, balances: [listed(usdcToken, "USDC.e", "10.000001")] },
      requests: [`balanceOf ${usdcToken} ${wallet}`],
    },
    {
      name: "--token the wallet holds none of",
      state: walletState(),
      argv: ["--token", "OUSD"],
      onChain: {},
      assets: {},
      expected: { ...mainnet, balances: [listed(ousdToken, "OUSD", "0")] },
      requests: [`balanceOf ${ousdToken} ${wallet}`],
    },
  ])("shows $name", async ({ state, argv, onChain, assets, failRpc, expected, requests }) => {
    const home = await useTempHome();
    await writeWalletState(state);
    const host = await walletHost({ onChain, assets, failRpc, chainId: expected.chain_id });
    try {
      const result = await run(["balance", ...argv, "--format", "json"], home, host.url);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      const output = JSON.parse(result.stdout);
      expect(output).toEqual({ wallet, ...expected });
      expect(balanceOutput.parse(output)).toEqual(output);
      expect(host.requests.toSorted()).toEqual(requests.toSorted());
    } finally {
      await host.close();
    }
  });

  it.each([
    {
      name: "the default token cannot be read and the wallet app reports none",
      argv: [],
      onChain: {},
      assets: {},
      failRpc: true,
    },
    {
      name: "the default token cannot be read and the wallet app reports only others",
      argv: [],
      onChain: {},
      assets: {
        4217: [{ address: ousdToken, balance: "1", decimals: 6, symbol: "OUSD", verified: true }],
      },
      failRpc: true,
    },
    {
      name: "--token cannot be read, though the wallet app would report it",
      argv: ["--token", "USDC.e"],
      onChain: {},
      assets: {
        4217: [
          { address: usdcToken, balance: "7000000", decimals: 6, symbol: "USDC.e", verified: true },
        ],
      },
      failRpc: true,
    },
    // The loopback RPC answers only `balanceOf`, so the token's metadata read fails.
    {
      name: "an unlisted --token's decimals cannot be read",
      argv: ["--token", unlistedToken],
      onChain: { [unlistedToken]: 1n },
      assets: {},
      failRpc: false,
    },
  ])("returns a retryable E_NETWORK when $name", async ({ argv, onChain, assets, failRpc }) => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    const host = await walletHost({ onChain, assets, failRpc });
    try {
      const result = await run(["balance", ...argv, "--format", "json"], home, host.url);

      expect(result.code).toBe(3);
      expect(JSON.parse(result.stdout)).toEqual({
        code: "E_NETWORK",
        message: "Unable to query token balance. Check RPC connectivity and TEMPO_RPC_URL.",
        retryable: true,
      });
    } finally {
      await host.close();
    }
  });

  it.each(tokenInputs)(
    "--token $input on $network shows only $symbol",
    async ({ input, network, address, symbol }) => {
      await useTempHome();
      await writeWalletState(walletState());
      const host = await walletHost({
        onChain: { [address]: 3_000_000n },
        assets: {},
        chainId: parseNetwork(network).chainId,
      });
      vi.stubEnv("TEMPO_RPC_URL", host.url);
      try {
        const output = await balanceHandler(await readyWallet(network, false), { token: input });

        expect(output.balances).toEqual([listed(address, symbol, "3")]);
        expect(host.requests).toEqual([`balanceOf ${address} ${wallet}`]);
      } finally {
        await host.close();
      }
    },
  );

  it.each(invalidTokenInputs("token"))(
    "rejects --token $input on $network before reading anything",
    async ({ input, network, message }) => {
      await useTempHome();
      await writeWalletState(walletState());
      const host = await walletHost({ onChain: {}, assets: {} });
      vi.stubEnv("TEMPO_RPC_URL", host.url);
      try {
        const error = await balanceHandler(await readyWallet(network, false), {
          token: input,
        }).catch((value: unknown) => value);

        expectTokenError(error, message);
        expect(host.requests).toEqual([]);
      } finally {
        await host.close();
      }
    },
  );

  it.each([
    {
      name: "in its on-chain decimals, with its ticker",
      metadata: { decimals: 18, symbol: "TKN" },
      raw: 1_500_000_000_000_000_000n,
      shown: { symbol: "TKN", decimals: 18, balance: "1.5" },
    },
    {
      name: "with a 2-decimal balance",
      metadata: { decimals: 2, symbol: "CENT" },
      raw: 1021n,
      shown: { symbol: "CENT", decimals: 2, balance: "10.21" },
    },
    ...untrustedSymbols.map((symbol) => ({
      name: `by address alone for symbol ${JSON.stringify(symbol)}`,
      metadata: { decimals: 6, symbol },
      raw: 1_000_000n,
      shown: { symbol: null, decimals: 6, balance: "1" },
    })),
  ])("shows an unlisted --token $name", async ({ metadata, raw, shown }) => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.getMetadata.mockResolvedValue(metadata);
    const host = await walletHost({ onChain: { [unlistedToken]: raw }, assets: {} });
    vi.stubEnv("TEMPO_RPC_URL", host.url);
    try {
      const output = await balanceHandler(await readyWallet("mainnet", false), {
        token: unlistedToken.toUpperCase().replace("0X", "0x"),
      });

      expect(output.balances).toEqual([{ token: unlistedToken, ...shown, verified: false }]);
      expect(containsSymbol(output, metadata.symbol)).toBe(shown.symbol !== null);
      expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual([
        { token: unlistedToken },
      ]);
    } finally {
      await host.close();
    }
  });
});

describe("tempo wallet address", () => {
  it.each([
    { name: "the mainnet login", state: walletState(), argv: [], env: {}, expected: mainnet },
    {
      name: "the testnet login",
      state: walletState({ chainId: 42431, accessKeys: [] }),
      argv: [],
      env: {},
      expected: testnet,
    },
    {
      name: "--network over the login",
      state: walletState(),
      argv: ["-n", "testnet"],
      env: {},
      expected: testnet,
    },
    {
      name: "TEMPO_WALLET_NETWORK over the login",
      state: walletState({ chainId: 42431, accessKeys: [] }),
      argv: [],
      env: { TEMPO_WALLET_NETWORK: "mainnet" },
      expected: mainnet,
    },
  ])("shows the wallet on $name without a request", async ({ state, argv, env, expected }) => {
    const home = await useTempHome();
    await writeWalletState(state);
    const host = await walletHost({ onChain: {}, assets: {} });
    try {
      const result = await run(["address", ...argv, "--format", "json"], home, host.url, { env });

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual({ address: wallet, ...expected });
      expect(host.requests).toEqual([]);
    } finally {
      await host.close();
    }
  });

  it.each([
    { name: "a terminal with --qr", argv: ["--qr"], interactive: true, qr: true },
    { name: "a terminal without --qr", argv: [], interactive: true, qr: false },
    { name: "--format json", argv: ["--qr", "--format", "json"], interactive: true, qr: false },
    { name: "piped output", argv: ["--qr"], interactive: false, qr: false },
  ])("prints a QR code on $name: $qr", async ({ argv, interactive, qr }) => {
    const home = await useTempHome();
    await writeWalletState(walletState());

    const result = await run(["address", ...argv], home, "http://127.0.0.1:9", { interactive });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const code = encodeQR(wallet, "term");
    expect(result.stdout.startsWith(code)).toBe(qr);
    const output = qr ? result.stdout.slice(code.length) : result.stdout;
    // Only the code is drawn with escape sequences; the output is the same with or without it.
    expect(output).not.toContain("\u001b");
    expect(output).toContain(wallet);
    if (argv.includes("json")) expect(JSON.parse(output)).toEqual({ address: wallet, ...mainnet });
  });
});

describe("balance and address", () => {
  it.each([
    { argv: ["balance"], network: "mainnet" },
    { argv: ["balance", "--token", "USDC", "-n", "testnet"], network: "testnet" },
    { argv: ["address"], network: "mainnet" },
    { argv: ["address", "--qr", "-n", "testnet"], network: "testnet" },
  ])("$argv without a login returns E_NOT_AUTHENTICATED", async ({ argv, network }) => {
    const home = await useTempHome();
    await writeWalletState(walletState({ accounts: [] }));
    const host = await walletHost({ onChain: {}, assets: {} });
    try {
      const result = await run([...argv, "--format", "json"], home, host.url);

      const command = `tempo wallet login --network ${network}`;
      expect(result.code).toBe(4);
      expect(JSON.parse(result.stdout)).toEqual({
        code: "E_NOT_AUTHENTICATED",
        message: `No wallet is logged in. Run '${command}' before retrying.`,
        retryable: false,
        cta: { description: "Suggested command:", commands: [{ command }] },
      });
      expect(host.requests).toEqual([]);
    } finally {
      await host.close();
    }
  });

  it.each(
    [
      { name: "no access key", state: walletState({ accessKeys: [] }) },
      {
        name: "an expired access key",
        state: walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, expiry: 1 }] }),
      },
    ].flatMap((row) => [
      {
        ...row,
        argv: ["balance"],
        expected: { wallet, balances: [listed(usdcToken, "USDC.e", "1")] },
      },
      { ...row, argv: ["address"], expected: { address: wallet } },
    ]),
  )("$argv runs with $name", async ({ state, argv, expected }) => {
    const home = await useTempHome();
    await writeWalletState(state);
    const host = await walletHost({ onChain: { [usdcToken]: 1_000_000n }, assets: {} });
    try {
      const result = await run([...argv, "--format", "json"], home, host.url);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ...mainnet, ...expected });
    } finally {
      await host.close();
    }
  });

  it("lists both commands in --describe after whoami", async () => {
    const result = await run(["--describe"], await useTempHome(), "http://127.0.0.1:9");
    const manifest = JSON.parse(result.stdout) as {
      subcommands: { name: string; args?: { long?: string }[] }[];
    };

    const names = manifest.subcommands.map((command) => command.name);
    expect(names.slice(names.indexOf("whoami"), names.indexOf("whoami") + 3)).toEqual([
      "whoami",
      "balance",
      "address",
    ]);
    const args = (name: string) =>
      manifest.subcommands.find((command) => command.name === name)?.args?.map((arg) => arg.long);
    expect(args("balance")).toEqual(["--token"]);
    expect(args("address")).toEqual(["--qr"]);
  });
});

/**
 * Stands in for the chain RPC and the wallet app. `eth_chainId` answers `chainId` (mainnet by
 * default), since balances read through a TEMPO_RPC_URL count only on its chain; `balanceOf`
 * answers from `onChain` by token, `/api/assets` from `assets` by chain ID, and `failRpc` fails
 * every other RPC call. Records each balance read and asset lookup with the wallet it names, and
 * any other request but `eth_chainId`, which fails.
 */
async function walletHost(options: {
  onChain: Record<string, bigint>;
  assets: Record<number, unknown[]>;
  failRpc?: boolean | undefined;
  chainId?: number | undefined;
}) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/assets") {
      const chainId = Number(url.searchParams.get("chainId"));
      requests.push(`assets ${chainId} ${url.searchParams.get("address")?.toLowerCase()}`);
      response.end(JSON.stringify(options.assets[chainId] ?? []));
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body || "{}") as {
        id: number;
        method: string;
        params?: [{ to?: string; data?: `0x${string}` }];
      };
      if (method === "eth_chainId") {
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id, result: toHex(options.chainId ?? 4217) }),
        );
        return;
      }
      const call = params?.[0];
      const balanceOf =
        method === "eth_call" && call?.to && call.data?.startsWith("0x70a08231")
          ? decodeFunctionData({ abi: erc20Abi, data: call.data })
          : undefined;
      if (options.failRpc || !balanceOf || !call?.to) {
        requests.push(`${request.method} ${url.pathname} ${method}`);
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unexpected" } }),
        );
        return;
      }
      const token = call.to.toLowerCase();
      requests.push(`balanceOf ${token} ${String(balanceOf.args[0]).toLowerCase()}`);
      const balance = options.onChain[token] ?? 0n;
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: `0x${balance.toString(16).padStart(64, "0")}`,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Runs the wallet CLI with `host` as its chain RPC and wallet app: as an agent, or with
 * `interactive` as a person at a terminal.
 */
function run(
  args: string[],
  home: string,
  host: string,
  { interactive = false, env = {} }: { interactive?: boolean; env?: Record<string, string> } = {},
) {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    HOME: home,
    TEMPO_AUTH_URL: host,
    TEMPO_RPC_URL: host,
  };
  delete childEnv.TEMPO_WALLET_NETWORK;
  Object.assign(childEnv, env);
  const fixture = join(import.meta.dirname, "fixtures", "interactive-stdout.mjs");
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      interactive
        ? ["--import", fixture, cliBundle("wallet"), ...args]
        : [cliBundle("wallet"), ...args],
      { env: childEnv, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
