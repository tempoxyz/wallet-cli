import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { debugHandler } from "../src/commands/debug.js";
import { doctorHandler, redactUrl } from "../src/commands/doctor.js";
import { channelsDbPath } from "../src/shared/process.js";
import type { WalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  testAccessKey,
  testPrivateKey,
  testPrivateKey2,
  testWallet,
  unlistedToken,
  usdc,
  useTempHome,
  walletState,
  writeRawWalletStore,
  writeWalletState,
} from "./helpers.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

const overrides = [
  "TEMPO_WALLET_NETWORK",
  "TEMPO_RPC_URL",
  "TEMPO_AUTH_URL",
  "TEMPO_MAX_SPEND",
  "TEMPO_WALLET_FUND_TIMEOUT_MS",
  "TEMPO_WALLET_FUND_POLL_MS",
  "TEMPO_PRIVATE_KEY",
];

const deprecation = "Warning: 'tempo wallet debug' is deprecated; use 'tempo wallet doctor'.";

const mainnetKey = walletState().accessKeys[0]!;
const testnetKey = { ...mainnetKey, chainId: 42431 };
const login = (network: string) => ["tempo", "wallet", "login", "--network", network];
const refresh = (network: string) => ["tempo", "wallet", "refresh", "--network", network];

/** How the stubbed RPC answers `eth_chainId`; by default, with the chain its URL serves. */
type Rpc = "ok" | "down" | "wrong chain" | "http 503" | "hung";

const bins: string[] = [];
let rpc: Rpc;
let rpcMethods: string[];

beforeEach(async () => {
  await useTempHome();
  for (const name of overrides) vi.stubEnv(name, undefined);
  vi.stubEnv("PATH", await sqliteBin("present"));
  rpc = "ok";
  rpcMethods = [];
  vi.stubGlobal("fetch", vi.fn(rpcFetch));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(bins.splice(0).map((bin) => rm(bin, { force: true, recursive: true })));
});

async function rpcFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const { id, method } = JSON.parse(String(init?.body)) as { id: number; method: string };
  rpcMethods.push(method);
  if (rpc === "down") throw new TypeError("fetch failed");
  if (rpc === "http 503") return new Response("unavailable", { status: 503 });
  if (rpc === "hung")
    return await new Promise<Response>((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    );
  const chainId = rpc === "wrong chain" ? 1 : url.includes("moderato") ? 42431 : 4217;
  return Response.json({ jsonrpc: "2.0", id, result: `0x${chainId.toString(16)}` });
}

/** A PATH directory whose `sqlite3` reports a version, hangs, or is absent. */
async function sqliteBin(sqlite: "present" | "hung" | "missing") {
  const bin = await mkdtemp(join(tmpdir(), "wallet-cli-doctor-bin-"));
  bins.push(bin);
  const script = {
    present:
      'echo "3.45.1 2024-01-30 16:01:20 e876e51a0ed5c5b3126f52e532044363a014bc594cfefa87 (64-bit)"',
    hung: "exec /bin/sleep 30",
    missing: undefined,
  }[sqlite];
  if (script) {
    await writeFile(join(bin, "sqlite3"), `#!/bin/sh\n${script}\n`);
    await chmod(join(bin, "sqlite3"), 0o755);
  }
  return bin;
}

// Healthy checks get a budget a loaded CI runner can meet; only the hung cases pass a short one.
function doctor(network?: string, timeout = 5_000) {
  return doctorHandler({ network }, { timeout });
}

function check(report: Awaited<ReturnType<typeof doctor>>, name: string) {
  return report.checks.find((candidate) => candidate.name === name);
}

describe("wallet", () => {
  it.each<{
    name: string;
    network?: string;
    store?: () => Promise<void>;
    wallet: Record<string, unknown>;
    status: string;
    message: unknown;
    next?: string[];
  }>([
    {
      name: "logged out",
      wallet: { logged_in: false, address: null, type: null, chain_id: null, network: null },
      status: "fail",
      message: "No wallet is logged in.",
      next: login("mainnet"),
    },
    {
      name: "logged in",
      store: () => writeWalletState(walletState()),
      wallet: { logged_in: true, address: testWallet.toLowerCase(), chain_id: 4217 },
      status: "ok",
      message: `Logged in as ${testWallet.toLowerCase()} on mainnet.`,
    },
    {
      name: "logged in on another network",
      network: "testnet",
      store: () => writeWalletState(walletState({ accessKeys: [mainnetKey, testnetKey] })),
      wallet: { logged_in: true, chain_id: 4217, network: "tempo" },
      status: "warn",
      message: `Wallet ${testWallet.toLowerCase()} is logged in on tempo, not tempo-moderato.`,
      next: login("testnet"),
    },
    {
      // The network falls back to mainnet, so the message must name the stored chain itself.
      name: "logged in on an unsupported chain",
      store: () => writeWalletState(walletState({ chainId: 1 })),
      wallet: { logged_in: true, chain_id: 1, network: "chain-1" },
      status: "warn",
      message: `Wallet ${testWallet.toLowerCase()} is logged in on chain-1, not tempo.`,
      next: login("mainnet"),
    },
    {
      name: "an unreadable wallet store",
      store: () =>
        writeRawWalletStore(`{"tempo-cli.store": {"state": {"accessKeys": ["${testPrivateKey}`),
      wallet: { logged_in: false, address: null },
      status: "fail",
      message: expect.stringMatching(
        /^The wallet store .*store\.json is not a valid wallet store\.$/,
      ),
    },
  ])("reports $name", async ({ network, store, wallet, status, message, next }) => {
    await store?.();

    const report = await doctor(network);

    expect(report.wallet).toMatchObject({ ...wallet, private_key_env: false });
    expect(check(report, "wallet")).toEqual({ name: "wallet", status, message });
    expect(report._next?.argv).toEqual(next);
    expect(JSON.stringify(report)).not.toContain(testPrivateKey.slice(2));
  });

  it.each([
    { keyType: undefined, type: "device_code" },
    { keyType: "webAuthn", type: "passkey" },
    { keyType: "webAuthn_headless", type: "passkey" },
    { keyType: "secp256k1", type: "private_key" },
    { keyType: "p256", type: "private_key" },
    { keyType: "webCrypto", type: "private_key" },
    { keyType: "unknown", type: null },
  ])("derives wallet type $type from the stored key type $keyType", async ({ keyType, type }) => {
    await writeWalletState(walletState({ accounts: [{ address: testWallet, keyType }] }));

    expect((await doctor()).wallet.type).toBe(type);
  });
});

describe("key", () => {
  const authorization = {
    address: testAccessKey,
    chainId: 4217,
    type: "secp256k1",
    signature: { r: "0x1", s: "0x2", yParity: 0 },
  };

  it.each<{
    name: string;
    accessKeys: WalletState["accessKeys"];
    key: Record<string, unknown>;
    status: string;
    message: string;
    next?: string[];
  }>([
    {
      name: "ready",
      accessKeys: [mainnetKey],
      key: { address: testAccessKey, status: "ready", expires_at: "2033-05-18T03:33:20Z" },
      status: "ok",
      message: `Access key ${testAccessKey} is ready until 2033-05-18T03:33:20Z.`,
    },
    {
      name: "pending",
      accessKeys: [{ ...mainnetKey, keyAuthorization: authorization }],
      key: { status: "pending" },
      status: "ok",
      message: `Access key ${testAccessKey} is authorized and published with its first payment.`,
    },
    {
      name: "expired",
      accessKeys: [{ ...mainnetKey, expiry: 1_000 }],
      key: { status: "expired", expires_at: "1970-01-01T00:16:40Z" },
      status: "fail",
      message: `Access key ${testAccessKey} expired at 1970-01-01T00:16:40Z.`,
      next: refresh("mainnet"),
    },
    {
      name: "unusable",
      accessKeys: [{ ...mainnetKey, privateKey: undefined }],
      key: { status: "unusable" },
      status: "fail",
      message: `Access key ${testAccessKey} cannot sign on this host.`,
      next: refresh("mainnet"),
    },
    {
      name: "missing",
      accessKeys: [testnetKey],
      key: { address: null, status: "missing", expires_at: null, spending_limits: [] },
      status: "fail",
      message: `No access key is stored for wallet ${testWallet.toLowerCase()} on mainnet.`,
      next: refresh("mainnet"),
    },
    {
      // Outside `Date`'s range, so formatting it would throw.
      name: "invalid expiry",
      accessKeys: [{ ...mainnetKey, expiry: 10_000_000_000_000 }],
      key: { address: testAccessKey, expires_at: null },
      status: "fail",
      message: `Access key ${testAccessKey} has an invalid expiry (10000000000000) in the wallet store. Run 'tempo wallet logout', then 'tempo wallet login'.`,
    },
  ])("reports a $name key", async ({ accessKeys, key, status, message, next }) => {
    await writeWalletState(walletState({ accessKeys }));

    const report = await doctor();

    expect(report.key).toMatchObject(key);
    expect(check(report, "key")).toEqual({ name: "key", status, message });
    expect(report._next?.argv).toEqual(next);
    if (next)
      expect(report.instruction).toBe(
        `${message} Run the next command to authorize a new access key on mainnet.`,
      );
  });

  it("formats spending limits like whoami without reading tokens on chain", async () => {
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            ...mainnetKey,
            limits: [
              { token: usdc, limit: "100000000#__bigint" },
              { token: unlistedToken, limit: "5#__bigint", period: 86_400 },
            ],
          },
        ],
      }),
    );

    const report = await doctor();

    expect(report.key.spending_limits).toEqual([
      {
        unlimited: false,
        symbol: "USDC.e",
        token: usdc.toLowerCase(),
        limit: "100.000000",
        raw_limit: "100000000",
        period_seconds: null,
        remaining: null,
        spent: null,
      },
      {
        unlimited: false,
        symbol: null,
        token: unlistedToken,
        limit: null,
        raw_limit: "5",
        period_seconds: 86_400,
        remaining: null,
        spent: null,
      },
    ]);
    expect(rpcMethods).toEqual(["eth_chainId"]);
  });
});

describe("rpc", () => {
  it.each<{ rpc: Rpc; section: Record<string, unknown>; status: string; message: string }>([
    {
      rpc: "ok",
      section: { ok: true, chain_id: 4217, chain_matches: true, latency_ms: expect.any(Number) },
      status: "ok",
      message: "RPC https://rpc.mainnet.tempo.xyz answered in ",
    },
    {
      rpc: "down",
      section: { ok: false, chain_id: null, chain_matches: null, latency_ms: null },
      status: "fail",
      message:
        "RPC https://rpc.mainnet.tempo.xyz could not be reached. Check your network connection.",
    },
    {
      rpc: "wrong chain",
      section: { ok: true, chain_id: 1, chain_matches: false, latency_ms: expect.any(Number) },
      status: "fail",
      message:
        "RPC https://rpc.mainnet.tempo.xyz is on chain 1, not mainnet (4217). Check your network connection.",
    },
    {
      rpc: "http 503",
      section: { ok: false, chain_id: null, chain_matches: null, latency_ms: null },
      status: "fail",
      message:
        "RPC https://rpc.mainnet.tempo.xyz answered HTTP 503. Check your network connection.",
    },
    {
      rpc: "hung",
      section: { ok: false, chain_id: null, chain_matches: null, latency_ms: null },
      status: "fail",
      message:
        "RPC https://rpc.mainnet.tempo.xyz did not answer within 500ms. Check your network connection.",
    },
  ])("reports an RPC that is $rpc", async ({ rpc: mode, section, status, message }) => {
    await writeWalletState(walletState());
    rpc = mode;

    const report = await doctor(undefined, mode === "hung" ? 500 : undefined);

    expect(report.rpc).toEqual({ url: "https://rpc.mainnet.tempo.xyz", ...section });
    expect(check(report, "rpc")).toEqual({
      name: "rpc",
      status,
      message: expect.stringContaining(message),
    });
    // Each check is asked once: the RPC is not retried.
    expect(rpcMethods).toEqual(["eth_chainId"]);
    // An RPC problem has no fix command.
    expect(report._next).toBeUndefined();
  });

  it("asks the RPC of the resolved network", async () => {
    await writeWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));

    expect((await doctor()).rpc).toMatchObject({
      url: "https://rpc.moderato.tempo.xyz",
      chain_id: 42431,
      chain_matches: true,
    });
  });
});

describe("sqlite3 and the session store", () => {
  it.each([
    {
      sqlite: "present" as const,
      section: { found: true, version: "3.45.1" },
      status: "ok",
      message: "sqlite3 3.45.1 is installed.",
    },
    {
      sqlite: "missing" as const,
      section: { found: false, version: null },
      status: "warn",
      message: "sqlite3 was not found on PATH. Payment sessions need it: install sqlite3.",
    },
  ])("reports sqlite3 $sqlite", async ({ sqlite, section, status, message }) => {
    await writeWalletState(walletState());
    vi.stubEnv("PATH", await sqliteBin(sqlite));

    const report = await doctor();

    expect(report.sqlite3).toEqual(section);
    expect(check(report, "sqlite3")).toEqual({ name: "sqlite3", status, message });
    expect(report._next).toBeUndefined();
  });

  it.each([
    {
      name: "absent",
      mode: undefined,
      section: { exists: false, readable: false },
      status: "ok",
      message: "No payment sessions are recorded yet.",
    },
    {
      name: "readable",
      mode: 0o600,
      section: { exists: true, readable: true },
      status: "ok",
      message: "The session store is readable.",
    },
    ...(process.getuid?.() === 0
      ? []
      : [
          {
            name: "unreadable",
            mode: 0o000,
            section: { exists: true, readable: false },
            status: "fail",
            message: expect.stringMatching(/^The session store .*channels\.db is not readable\.$/),
          },
        ]),
  ])("reports an $name session store", async ({ mode, section, status, message }) => {
    if (mode !== undefined) {
      await mkdir(dirname(channelsDbPath()), { recursive: true });
      await writeFile(channelsDbPath(), "");
      await chmod(channelsDbPath(), mode);
    }

    const report = await doctor();

    expect(report.session_store).toEqual({ path: channelsDbPath(), ...section });
    expect(check(report, "session_store")).toEqual({ name: "session_store", status, message });
  });

  it.skipIf(process.getuid?.() === 0)(
    "fails a session store whose directory cannot be searched",
    async () => {
      const directory = dirname(channelsDbPath());
      await chmod(directory, 0o000);
      try {
        const report = await doctor();

        expect(report.session_store).toEqual({
          path: channelsDbPath(),
          exists: null,
          readable: false,
        });
        expect(check(report, "session_store")).toEqual({
          name: "session_store",
          status: "fail",
          message: `The session store ${channelsDbPath()} cannot be reached (EACCES).`,
        });
      } finally {
        await chmod(directory, 0o700);
      }
    },
  );
});

describe("environment", () => {
  it.each([
    { name: "RPC user info", env: { TEMPO_RPC_URL: "https://rpc-user:SECRET-1@127.0.0.1:9" } },
    { name: "an RPC path key", env: { TEMPO_RPC_URL: "https://127.0.0.1:9/v2/SECRET-1" } },
    { name: "an RPC query key", env: { TEMPO_RPC_URL: "https://127.0.0.1:9/?apikey=SECRET-1" } },
    { name: "an RPC fragment", env: { TEMPO_RPC_URL: "https://127.0.0.1:9#SECRET-1" } },
    { name: "a malformed RPC URL", env: { TEMPO_RPC_URL: "not a url SECRET-1" } },
    {
      name: "auth URL credentials",
      env: { TEMPO_AUTH_URL: "https://a:SECRET-1@w.example/SECRET-1" },
    },
    { name: "TEMPO_PRIVATE_KEY", env: { TEMPO_PRIVATE_KEY: testPrivateKey2 } },
  ])("never shows a secret from $name", async ({ env }) => {
    await writeWalletState(walletState());
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const secret = env.TEMPO_PRIVATE_KEY ?? "SECRET-1";

    const report = await doctor();

    const output = JSON.stringify(report);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(secret.slice(2));
    // The stored access key's private key never appears either.
    expect(output).not.toContain(testPrivateKey.slice(2));
    expect(report.env.map((entry) => entry.name)).toEqual(Object.keys(env));
    expect(report.wallet.private_key_env).toBe("TEMPO_PRIVATE_KEY" in env);
  });

  it("shows the values of non-secret overrides and only names a secret", async () => {
    await writeWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));
    vi.stubEnv("TEMPO_WALLET_NETWORK", "testnet");
    vi.stubEnv("TEMPO_RPC_URL", "https://rpc.example.com/v2/key?token=abc");
    vi.stubEnv("TEMPO_MAX_SPEND", "5");
    vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey2);

    const report = await doctor();

    expect(report.env).toEqual([
      { name: "TEMPO_WALLET_NETWORK", value: "testnet" },
      { name: "TEMPO_RPC_URL", value: "https://rpc.example.com/<redacted>?<redacted>" },
      { name: "TEMPO_MAX_SPEND", value: "5" },
      { name: "TEMPO_PRIVATE_KEY", value: null },
    ]);
    expect(report.rpc.url).toBe("https://rpc.example.com/<redacted>?<redacted>");
    expect(check(report, "env")).toEqual({
      name: "env",
      status: "ok",
      message:
        "Overrides set: TEMPO_WALLET_NETWORK, TEMPO_RPC_URL, TEMPO_MAX_SPEND, TEMPO_PRIVATE_KEY.",
    });
  });

  it("reports an unsupported TEMPO_WALLET_NETWORK instead of failing", async () => {
    await writeWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));
    vi.stubEnv("TEMPO_WALLET_NETWORK", "typo");

    const report = await doctor();

    expect(report).toMatchObject({ chain_id: 42431, network: "tempo-moderato" });
    expect(check(report, "env")).toMatchObject({ status: "fail" });
    expect(report.env).toEqual([{ name: "TEMPO_WALLET_NETWORK", value: "typo" }]);
  });

  it.each([
    { value: "https://wallet.example", status: "ok" },
    { value: "http://127.0.0.1:3000", status: "ok" },
    { value: "", status: "fail" },
    { value: "wallet.example", status: "fail" },
    { value: "localhost:3000", status: "fail" },
    { value: "ftp://wallet.example", status: "fail" },
  ])("reports TEMPO_AUTH_URL $value as $status", async ({ value, status }) => {
    vi.stubEnv("TEMPO_AUTH_URL", value);

    const report = await doctor();

    expect(check(report, "env")).toEqual({
      name: "env",
      status,
      message:
        status === "ok"
          ? "Overrides set: TEMPO_AUTH_URL."
          : "TEMPO_AUTH_URL is not an http(s) URL, so login and other wallet app requests fail. Set it to the wallet app URL, or unset it.",
    });
  });

  it("rejects an unsupported --network as a usage error", async () => {
    await expect(doctor("typo")).rejects.toMatchObject({
      code: "E_USAGE",
      message: "Unsupported network: typo",
    });
  });

  it.each([
    ["https://rpc.mainnet.tempo.xyz", "https://rpc.mainnet.tempo.xyz"],
    ["http://127.0.0.1:8545/", "http://127.0.0.1:8545"],
    ["https://user:pass@rpc.example.com", "https://<redacted>@rpc.example.com"],
    ["https://token@rpc.example.com:8443", "https://<redacted>@rpc.example.com:8443"],
    ["https://rpc.example.com/v2/key", "https://rpc.example.com/<redacted>"],
    ["https://rpc.example.com/?apikey=key", "https://rpc.example.com?<redacted>"],
    ["https://rpc.example.com#key", "https://rpc.example.com#<redacted>"],
    ["not a url", "<redacted>"],
  ])("redacts %s as %s", (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});

it("reports the other checks when the RPC and sqlite3 hang", async () => {
  await writeWalletState(walletState());
  rpc = "hung";
  vi.stubEnv("PATH", await sqliteBin("hung"));
  const started = Date.now();

  const report = await doctorHandler({}, { timeout: 200 });

  expect(Date.now() - started).toBeLessThan(5_000);
  expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
    ["wallet", "ok"],
    ["key", "ok"],
    ["rpc", "fail"],
    ["sqlite3", "warn"],
    ["session_store", "ok"],
    ["env", "ok"],
  ]);
  expect(report.sqlite3).toEqual({ found: true, version: null });
});

it("reports versions without placeholders", async () => {
  const { dependencies, version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string>; version: string };

  expect((await doctor()).versions).toEqual({
    wallet_cli: version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    incur: dependencies.incur,
    accounts: dependencies.accounts,
  });
});

it("keeps debug as an alias that notes its deprecation on stderr", async () => {
  await writeWalletState(walletState());
  rpc = "down";
  const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const debug = await debugHandler({});

  expect(stderr.mock.calls).toEqual([[deprecation]]);
  stderr.mockClear();
  expect(debug).toEqual(await doctorHandler({}));
  expect(stderr).not.toHaveBeenCalled();
});

it("prints doctor and debug from the CLI without secrets", async () => {
  await writeWalletState(walletState());
  const secrets = ["rpc-pass", "rpc-path", "rpc-query", "auth-pass", "auth-path"];
  const env = {
    ...process.env,
    TEMPO_RPC_URL: "http://rpc-user:rpc-pass@127.0.0.1:9/rpc-path?key=rpc-query",
    TEMPO_AUTH_URL: "http://auth-user:auth-pass@127.0.0.1:9/auth-path",
    TEMPO_PRIVATE_KEY: testPrivateKey2,
  };
  const run = (command: string) =>
    execFileAsync(process.execPath, [cliBundle("wallet"), command, "--format", "json"], { env });

  const [doctorRun, debugRun] = await Promise.all([run("doctor"), run("debug")]);

  for (const output of [doctorRun, debugRun].flatMap(({ stdout, stderr }) => [stdout, stderr]))
    for (const secret of [...secrets, testPrivateKey.slice(2), testPrivateKey2.slice(2)])
      expect(output).not.toContain(secret);
  expect(doctorRun.stderr).toBe("");
  expect(debugRun.stderr).toBe(`${deprecation}\n`);
  const report = JSON.parse(doctorRun.stdout) as Awaited<ReturnType<typeof doctor>>;
  expect(JSON.parse(debugRun.stdout)).toEqual(report);
  expect(report).toMatchObject({
    versions: { incur: expect.any(String), accounts: expect.any(String) },
    wallet: { logged_in: true, private_key_env: true },
    rpc: { url: "http://<redacted>@127.0.0.1:9/<redacted>?<redacted>", ok: false },
    auth: { url: "http://<redacted>@127.0.0.1:9/<redacted>" },
  });
}, 30_000);
