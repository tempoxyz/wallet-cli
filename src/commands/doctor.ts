import { access, constants } from "node:fs/promises";
import { arch, platform, version as nodeVersion } from "node:process";

import { HttpRequestError, TimeoutError } from "viem";

import { sdkVersions, version } from "../shared/constants.js";
import {
  appUrl,
  createTempoPublicClient,
  networkFields,
  parseNetwork,
  rpcUrl,
  storedChainId,
  walletNetwork,
  type Network,
} from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { channelsDbPath, runProcess, sqlite3 } from "../shared/process.js";
import { formatUnixTimestamp, sanitizeText } from "../shared/utils.js";
import {
  accessKeyMatches,
  localAccessKeyStatus,
  selectPaymentCapableAccessKey,
} from "../wallet/access-key.js";
import {
  emptyWalletState,
  loadWalletState,
  walletStorePath,
  type WalletState,
} from "../wallet/store.js";
import { keySpendingLimits } from "./identity.js";

/** How long the RPC request and the sqlite3 subprocess may take. */
const requestTimeout = 3_000;

/** How much longer than its request a check may run before it is reported as failed. */
const checkGrace = 1_000;

type Check = {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  /** The command that resolves the problem, when one does. */
  fix?: { argv: readonly string[]; instruction: string } | undefined;
};

/** A report section and the check that judges it. */
type Result<section> = { section: section; check: Check };

type StoreRead = { state: WalletState } | { error: string };

type RpcSection = {
  url: string;
  ok: boolean;
  chain_id: number | null;
  chain_matches: boolean | null;
  latency_ms: number | null;
};

type SqliteSection = { found: boolean; version: string | null };

type SessionStoreSection = { path: string; exists: boolean; readable: boolean };

const redacted = "<redacted>";

/**
 * Environment overrides the CLI reads, each with how its value is shown: `null` hides a secret,
 * and URLs are redacted (see `redactUrl`).
 */
const envOverrides: Record<string, (value: string) => string | null> = {
  TEMPO_WALLET_NETWORK: sanitizeText,
  TEMPO_RPC_URL: redactUrl,
  TEMPO_AUTH_URL: redactUrl,
  TEMPO_MAX_SPEND: sanitizeText,
  TEMPO_WALLET_FUND_TIMEOUT_MS: sanitizeText,
  TEMPO_WALLET_FUND_POLL_MS: sanitizeText,
  TEMPO_PRIVATE_KEY: () => null,
};

/**
 * Reports the CLI's setup on the resolved network: versions, the stored wallet and access key,
 * RPC reachability, sqlite3, the session store, and environment overrides, with a `checks`
 * verdict for each and, as `_next`, the command that fixes the most important problem. Checks
 * run concurrently, each with its own deadline, and an unhealthy setup is reported, never
 * thrown; only an invalid `--network` fails. Secrets never appear: `TEMPO_PRIVATE_KEY` is
 * reported as set or not, and URLs are redacted.
 */
export async function doctorHandler(
  options: { network?: string | undefined },
  { timeout = requestTimeout }: { timeout?: number | undefined } = {},
) {
  const flagNetwork = options.network === undefined ? undefined : parseNetwork(options.network);
  const deadline = timeout + checkGrace;
  const sqlite = bounded(deadline, sqliteCheck(timeout), (reason) =>
    result<SqliteSection>("sqlite3", { found: false, version: null }, "warn", `sqlite3 ${reason}.`),
  );
  const sessionStore = bounded(deadline, sessionStoreCheck(), (reason) =>
    result<SessionStoreSection>(
      "session_store",
      { path: channelsDbPath(), exists: false, readable: false },
      "fail",
      `The session store ${reason}.`,
    ),
  );
  const store = await bounded(
    deadline,
    loadWalletState().then(
      (state): StoreRead => ({ state }),
      (error: unknown): StoreRead => ({ error: storeError(error) }),
    ),
    (reason): StoreRead => ({ error: reason }),
  );
  const state = "state" in store ? store.state : undefined;
  const network = flagNetwork ?? envNetwork() ?? walletNetwork(state ?? emptyWalletState());

  const [rpc, key, sqliteResult, sessionStoreResult] = await Promise.all([
    bounded(deadline, rpcCheck(network, timeout), (reason) => rpcFailed(network, reason)),
    keyCheck(state, network),
    sqlite,
    sessionStore,
  ]);
  const wallet = walletCheck(store, network);
  const checks = [
    wallet.check,
    key.check,
    rpc.check,
    sqliteResult.check,
    sessionStoreResult.check,
    envCheck(),
  ];
  // Checks are listed most important first, so a failure's fix comes before a warning's.
  const fixable =
    checks.find((check) => check.status === "fail" && check.fix) ??
    checks.find((check) => check.status === "warn" && check.fix);

  return {
    ...networkFields(network.chainId),
    versions: {
      wallet_cli: version,
      node: nodeVersion,
      platform,
      arch,
      ...sdkVersions(),
    },
    wallet: wallet.section,
    key: key.section,
    rpc: rpc.section,
    auth: { url: redactUrl(appUrl) },
    sqlite3: sqliteResult.section,
    session_store: sessionStoreResult.section,
    env: Object.entries(envOverrides).flatMap(([name, show]) => {
      const value = process.env[name];
      return value === undefined ? [] : [{ name, value: show(value) }];
    }),
    checks: checks.map(({ fix: _fix, ...check }) => check),
    ...(fixable?.fix
      ? nextStep(`${fixable.message} ${fixable.fix.instruction}`, fixable.fix.argv, { network })
      : {}),
  };
}

/** The deprecated name of `doctor`: notes the rename on stderr and returns `doctor`'s report. */
export async function debugHandler(options: { network?: string | undefined }) {
  console.error("Warning: 'tempo wallet debug' is deprecated; use 'tempo wallet doctor'.");
  return await doctorHandler(options);
}

/**
 * `value` with each part of a URL that can carry a credential replaced by `<redacted>`: the
 * user info, a path other than `/`, the query, and the fragment. Only the scheme, host, and port
 * are kept, and a value that is not a URL is redacted whole.
 */
export function redactUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return redacted;
  }
  return [
    `${url.protocol}//`,
    url.username || url.password ? `${redacted}@` : "",
    url.host,
    url.pathname === "/" || url.pathname === "" ? "" : `/${redacted}`,
    url.search ? `?${redacted}` : "",
    url.hash ? `#${redacted}` : "",
  ].join("");
}

function result<section>(
  name: string,
  section: section,
  status: Check["status"],
  message: string,
  fix?: Check["fix"],
): Result<section> {
  return { section, check: { name, status, message, fix } };
}

/** Settles with `check`'s value, or with `fallback`'s once `ms` pass or if `check` rejects. */
async function bounded<value>(
  ms: number,
  check: Promise<value>,
  fallback: (reason: string) => value,
): Promise<value> {
  const timedOut = Promise.withResolvers<value>();
  const timer = setTimeout(() => timedOut.resolve(fallback(`did not finish within ${ms}ms`)), ms);
  try {
    return await Promise.race([
      check.catch(() => fallback("failed unexpectedly")),
      timedOut.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** `TEMPO_WALLET_NETWORK`'s network; `null` when it names no supported network. */
function envNetwork() {
  const value = process.env.TEMPO_WALLET_NETWORK;
  if (value === undefined) return undefined;
  try {
    return parseNetwork(value);
  } catch {
    return null;
  }
}

/** Why the wallet store could not be loaded; never its contents, which hold access keys. */
function storeError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code ? `could not be read (${code})` : "is not a valid wallet store";
}

function walletCheck(store: StoreRead, network: Network) {
  const state = "state" in store ? store.state : undefined;
  const account = state?.accounts[state.activeAccount ?? 0];
  const section = {
    logged_in: Boolean(account),
    address: account?.address.toLowerCase() ?? null,
    type: account ? walletType(account) : null,
    ...(state && account ? networkFields(storedChainId(state)) : { chain_id: null, network: null }),
    private_key_env: Boolean(process.env.TEMPO_PRIVATE_KEY),
  };

  if ("error" in store)
    return result(
      "wallet",
      section,
      "fail",
      `The wallet store ${walletStorePath()} ${store.error}.`,
    );
  if (!state || !account)
    return result("wallet", section, "fail", "No wallet is logged in.", login(network));
  if (storedChainId(state) !== network.chainId)
    return result(
      "wallet",
      section,
      "warn",
      `Wallet ${section.address} is logged in on ${walletNetwork(state).name}, not ${network.name}.`,
      login(network),
    );
  return result("wallet", section, "ok", `Logged in as ${section.address} on ${network.name}.`);
}

/**
 * What signs for the account, from the key type the SDK stored with it: a passkey, a local
 * private key, or, for an account stored without one, the wallet app through device-code login.
 * `null` for a key type the CLI does not know.
 */
function walletType(account: WalletState["accounts"][number]) {
  switch (account.keyType) {
    case undefined:
      return "device_code" as const;
    case "webAuthn":
    case "webAuthn_headless":
      return "passkey" as const;
    case "secp256k1":
    case "p256":
    case "webCrypto":
      return "private_key" as const;
    default:
      return null;
  }
}

/** The access key `whoami` reports for the wallet on `network`, read from the store alone. */
async function keyCheck(state: WalletState | undefined, network: Network) {
  const missing = {
    address: null,
    status: "missing" as const,
    expires_at: null,
    spending_limits: [],
  };
  const account = state?.accounts[state.activeAccount ?? 0];
  if (!state)
    return result("key", missing, "fail", "No access key: the wallet store could not be read.");
  if (!account)
    return result("key", missing, "fail", "No access key: no wallet is logged in.", login(network));

  const match = { chainId: network.chainId, walletAddress: account.address };
  const key =
    selectPaymentCapableAccessKey(state.accessKeys, match) ??
    state.accessKeys.find((candidate) => accessKeyMatches(candidate, match));
  if (!key)
    return result(
      "key",
      missing,
      "fail",
      `No access key is stored for wallet ${account.address.toLowerCase()} on ${network.name}.`,
      refresh(network),
    );

  const section = {
    address: key.address.toLowerCase(),
    status: localAccessKeyStatus(key),
    expires_at: formatUnixTimestamp(key.expiry),
    spending_limits: await keySpendingLimits(key),
  };
  const name = `Access key ${section.address}`;
  switch (section.status) {
    case "ready":
      return result(
        "key",
        section,
        "ok",
        `${name} is ready${section.expires_at ? ` until ${section.expires_at}` : ""}.`,
      );
    case "pending":
      return result(
        "key",
        section,
        "ok",
        `${name} is authorized and published with its first payment.`,
      );
    case "expired":
      return result(
        "key",
        section,
        "fail",
        `${name} expired${section.expires_at ? ` at ${section.expires_at}` : ""}.`,
        refresh(network),
      );
    case "unusable":
      return result("key", section, "fail", `${name} cannot sign on this host.`, refresh(network));
  }
}

/** Asks the RPC for its chain once, without retries, timing the round trip. */
async function rpcCheck(network: Network, timeout: number): Promise<Result<RpcSection>> {
  const url = redactUrl(rpcUrl(network.chainId));
  const started = performance.now();
  let chainId: number;
  try {
    const client = createTempoPublicClient(network.chainId, { timeout, retryCount: 0 });
    chainId = await client.getChainId();
  } catch (error) {
    return rpcFailed(network, rpcFailure(error, timeout));
  }
  const section = {
    url,
    ok: true,
    chain_id: chainId,
    chain_matches: chainId === network.chainId,
    latency_ms: Math.round(performance.now() - started),
  };
  return section.chain_matches
    ? result("rpc", section, "ok", `RPC ${url} answered in ${section.latency_ms}ms.`)
    : result(
        "rpc",
        section,
        "fail",
        `RPC ${url} is on chain ${chainId}, not ${network.name} (${network.chainId}). ${rpcHint()}`,
      );
}

function rpcFailed(network: Network, reason: string): Result<RpcSection> {
  const url = redactUrl(rpcUrl(network.chainId));
  return result(
    "rpc",
    { url, ok: false, chain_id: null, chain_matches: null, latency_ms: null },
    "fail",
    `RPC ${url} ${reason}. ${rpcHint()}`,
  );
}

/** Why `eth_chainId` failed, without the error's own text, which can repeat the RPC URL. */
function rpcFailure(error: unknown, timeout: number) {
  if (error instanceof TimeoutError) return `did not answer within ${timeout}ms`;
  if (error instanceof HttpRequestError)
    return error.status === undefined ? "could not be reached" : `answered HTTP ${error.status}`;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && code !== -1
    ? `answered with JSON-RPC error ${code}`
    : "did not return a chain ID";
}

function rpcHint() {
  return process.env.TEMPO_RPC_URL ? "Check TEMPO_RPC_URL." : "Check your network connection.";
}

/** Runs `sqlite3 --version` from PATH, the binary the session store uses. */
async function sqliteCheck(timeout: number): Promise<Result<SqliteSection>> {
  try {
    const stdout = await runProcess(sqlite3, ["--version"], {
      signal: AbortSignal.timeout(timeout),
    });
    const found = /^\d+(?:\.\d+)+/.exec(stdout.trim())?.[0] ?? null;
    return result(
      "sqlite3",
      { found: true, version: found },
      "ok",
      `sqlite3 ${found ?? "(unknown version)"} is installed.`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return result(
        "sqlite3",
        { found: false, version: null },
        "warn",
        "sqlite3 was not found on PATH. Payment sessions need it: install sqlite3.",
      );
    return result(
      "sqlite3",
      { found: true, version: null },
      "warn",
      "sqlite3 is on PATH, but 'sqlite3 --version' failed.",
    );
  }
}

/** Whether the session database exists and can be read; the first session creates it. */
async function sessionStoreCheck(): Promise<Result<SessionStoreSection>> {
  const path = channelsDbPath();
  const exists = await canAccess(path, constants.F_OK);
  const readable = exists && (await canAccess(path, constants.R_OK));
  const section = { path, exists, readable };
  if (!exists)
    return result("session_store", section, "ok", "No payment sessions are recorded yet.");
  if (!readable)
    return result("session_store", section, "fail", `The session store ${path} is not readable.`);
  return result("session_store", section, "ok", "The session store is readable.");
}

function canAccess(path: string, mode: number) {
  return access(path, mode).then(
    () => true,
    () => false,
  );
}

function envCheck(): Check {
  if (process.env.TEMPO_WALLET_NETWORK !== undefined && envNetwork() === null)
    return {
      name: "env",
      status: "fail",
      message:
        "TEMPO_WALLET_NETWORK names no supported network, so other commands fail. Set it to mainnet or testnet, or unset it.",
    };
  const set = Object.keys(envOverrides).filter((name) => process.env[name] !== undefined);
  return {
    name: "env",
    status: "ok",
    message: set.length ? `Overrides set: ${set.join(", ")}.` : "No overrides are set.",
  };
}

function login(network: Network) {
  return {
    argv: ["wallet", "login"],
    instruction: `Run the next command to log in on ${network.name}.`,
  };
}

function refresh(network: Network) {
  return {
    argv: ["wallet", "refresh"],
    instruction: `Run the next command to authorize a new access key on ${network.name}.`,
  };
}
