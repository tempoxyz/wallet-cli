import { execFile } from "node:child_process";
import { createServer } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/wallet/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/wallet/store.js")>();
  return { ...actual, loadWalletState: vi.fn(actual.loadWalletState) };
});

import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { withWallet } from "../src/shared/require-wallet.js";
import { loadWalletState, type WalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const key = walletState().accessKeys[0]!;
const testnetKey = { ...key, address: testAccessKey2, privateKey: testPrivateKey2, chainId: 42431 };
const expiredKey = { ...key, expiry: 1 };

const notReady: {
  name: string;
  state: WalletState;
  network?: string;
  code: string;
  message: string;
  command: string;
}[] = [
  {
    name: "no account",
    state: walletState({ accounts: [] }),
    code: "E_NOT_AUTHENTICATED",
    message: "No wallet is logged in.",
    command: "tempo wallet login --network mainnet",
  },
  {
    name: "no account with --network testnet",
    state: walletState({ accounts: [] }),
    network: "testnet",
    code: "E_NOT_AUTHENTICATED",
    message: "No wallet is logged in.",
    command: "tempo wallet login --network testnet",
  },
  {
    name: "an expired key",
    state: walletState({ accessKeys: [expiredKey] }),
    code: "E_KEY_EXPIRED",
    message: "The access key for this wallet on mainnet has expired.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "an expired key on the logged-in testnet chain",
    state: walletState({ chainId: 42431, accessKeys: [{ ...testnetKey, expiry: 1 }] }),
    code: "E_KEY_EXPIRED",
    message: "The access key for this wallet on testnet has expired.",
    command: "tempo wallet refresh --network testnet",
  },
  {
    name: "a key for another chain only",
    state: walletState(),
    network: "testnet",
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on testnet.",
    command: "tempo wallet refresh --network testnet",
  },
  {
    name: "no keys",
    state: walletState({ accessKeys: [] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "a key without signing material",
    state: walletState({ accessKeys: [{ ...key, privateKey: undefined }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "another wallet's key only",
    state: walletState({ accessKeys: [{ ...key, access: testWallet2 }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
];

const ready: {
  name: string;
  state: WalletState;
  network?: string;
  expected: { network: { name: string; chainId: number }; key: string };
}[] = [
  {
    name: "a usable key",
    state: walletState(),
    expected: { network: { name: "mainnet", chainId: 4217 }, key: testAccessKey },
  },
  {
    name: "a usable key after an expired one",
    state: walletState({ accessKeys: [expiredKey, { ...key, address: testAccessKey2 }] }),
    expected: { network: { name: "mainnet", chainId: 4217 }, key: testAccessKey2 },
  },
  {
    name: "a usable key on the --network chain",
    state: walletState({ accessKeys: [expiredKey, testnetKey] }),
    network: "testnet",
    expected: { network: { name: "testnet", chainId: 42431 }, key: testAccessKey2 },
  },
];

function runContext(network: string | undefined) {
  const error = vi.fn((value: unknown) => value);
  return { error, context: { globals: { network }, error: error as never } };
}

describe("withWallet", () => {
  it.each(notReady)(
    "returns $code for $name without running the command",
    async ({ state, network, code, message, command }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
      await writeWalletState(state);
      const handler = vi.fn();
      const { context, error } = runContext(network);

      const result = await withWallet(handler)(context);

      const expected = {
        code,
        message: `${message} Run '${command}' before retrying.`,
        exitCode: 4,
        retryable: false,
        cta: { commands: [{ command }] },
      };
      expect(result).toEqual(expected);
      expect(error).toHaveBeenCalledExactlyOnceWith(expected);
      expect(handler).not.toHaveBeenCalled();
      expect(loadWalletState).toHaveBeenCalledOnce();
    },
  );

  it.each(ready)("runs the command with $name", async ({ state, network, expected }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
    await writeWalletState(state);
    const handler = vi.fn(async () => "done");
    const { context, error } = runContext(network);

    expect(await withWallet(handler)(context)).toBe("done");

    expect(error).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledExactlyOnceWith(context, {
      state: expect.objectContaining({ accounts: [{ address: testWallet }] }),
      network: expected.network,
      account: { address: testWallet },
      key: expect.objectContaining({ address: expected.key, chainId: expected.network.chainId }),
    });
    expect(loadWalletState).toHaveBeenCalledOnce();
  });
});

const recipient = "0x1111111111111111111111111111111111111111";
const machChallenge = `Payment realm="example", method="tempo", intent="charge", id="abc123", expires="2099-01-01T00:00:00Z", request="${Buffer.from(
  JSON.stringify({
    amount: "1000000",
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217, machineTokenEnabled: true },
  }),
).toString("base64url")}"`;

const gatedCommands = [
  { command: "transfer", argv: ["transfer", "1", usdcToken, recipient, "--dry-run"] },
  {
    command: "transfer --mach",
    argv: ["transfer", "--mach", "--max-spend", "1", "--mpp-challenge", machChallenge, "--dry-run"],
  },
  { command: "swap", argv: ["swap", "1", usdcToken, moderatoToken, "--dry-run"] },
  { command: "keys update", argv: ["keys", "update", "--limit", "1", "--no-browser"] },
  { command: "revoke", argv: ["revoke", testAccessKey, "--dry-run"] },
  { command: "sessions close", argv: ["sessions", "close", "https://service.example"] },
];

// Each state selects testnet a different way, so the cta must carry the network the CLI resolved.
const gatedStates = [
  {
    name: "no account",
    state: walletState({ accounts: [] }),
    flags: ["-n", "testnet"],
    code: "E_NOT_AUTHENTICATED",
    cta: "tempo wallet login --network testnet",
  },
  {
    name: "an expired key",
    state: walletState({ chainId: 42431, accessKeys: [{ ...testnetKey, expiry: 1 }] }),
    code: "E_KEY_EXPIRED",
    cta: "tempo wallet refresh --network testnet",
  },
  {
    name: "no key for the chain",
    state: walletState(),
    env: { TEMPO_WALLET_NETWORK: "testnet" },
    code: "E_AUTH_REFRESH_REQUIRED",
    cta: "tempo wallet refresh --network testnet",
  },
];

describe("wallet CLI commands that need a usable key", () => {
  // Any RPC or wallet-approval request means the command ran past the check.
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.statusCode = 500;
    response.end();
  });
  let origin = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(gatedStates.flatMap((state) => gatedCommands.map((gated) => ({ ...state, ...gated }))))(
    "$command with $name returns $code",
    async ({ argv, state, flags = [], env = {}, code, cta }) => {
      const home = await useTempHome();
      await writeWalletState(state);
      requests.length = 0;

      const result = await wallet([...argv, ...flags], {
        HOME: home,
        TEMPO_AUTH_URL: origin,
        TEMPO_RPC_URL: origin,
        ...env,
      });

      expect(result.code).toBe(4);
      expect(JSON.parse(result.stdout)).toEqual({
        code,
        message: expect.stringContaining(`Run '${cta}'`),
        retryable: false,
        cta: { description: "Suggested command:", commands: [{ command: cta }] },
      });
      expect(result.stderr).toBe("");
      expect(requests).toEqual([]);
    },
  );

  it.each([
    {
      name: "--credits, which the wallet app signs",
      state: walletState({ accessKeys: [expiredKey] }),
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient, "--dry-run"],
      env: {},
    },
    {
      name: "--mach paid by TEMPO_PRIVATE_KEY",
      state: walletState({ accounts: [] }),
      argv: [
        "transfer",
        "--mach",
        "--max-spend",
        "1",
        "--mpp-challenge",
        machChallenge,
        "--dry-run",
      ],
      env: { TEMPO_PRIVATE_KEY: testPrivateKey2 },
    },
  ])("does not require a usable key for transfer $name", async ({ state, argv, env }) => {
    const home = await useTempHome();
    await writeWalletState(state);

    const result = await wallet(argv, { HOME: home, ...env });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dry_run: true });
  });
});

function wallet(args: string[], env: Record<string, string>) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...env };
  for (const name of ["TEMPO_PRIVATE_KEY", "TEMPO_WALLET_NETWORK"])
    if (!(name in env)) delete childEnv[name];
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [cliBundle("wallet"), ...args, "--format", "json"],
      { env: childEnv, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
