import { access, constants } from "node:fs/promises";
import { arch, platform, version as nodeVersion } from "node:process";

import { Cli } from "incur";
import { HttpRequestError, TimeoutError } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { checkSetting, configKeys } from "../schemas/config.js";
import { doctorOutput } from "../schemas/doctor.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { sdkVersions, version } from "../shared/constants.js";
import {
  appUrl,
  createTempoPublicClient,
  networkFields,
  networkName,
  parseNetwork,
  rpcUrl,
  rpcUrlOverride,
  storedChainId,
  walletNetwork,
  type Network,
} from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { channelsDbPath, runProcess, sqlite3 } from "../shared/process.js";
import { formatUnixTimestamp, sanitizeText } from "../shared/utils.js";
import { ConfigFileError, configValue } from "../wallet/config.js";
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
import { keySpendingLimits } from "../wallet/key-output.js";

export default {
  command: Cli.create("doctor", {
    description: "Diagnose login, access key, RPC, sqlite3, and environment setup",
    globals: cliGlobals,
    options: globalOptions,
    alias: globalAlias,
    output: doctorOutput,
    async run({ globals }) {
      return doctorHandler(globals);
    },
  }),
  annotations: { doctor: { ...readOnly, openWorldHint: true } },
  describe: {
    name: "doctor",
    about: "Diagnose login, access key, RPC, sqlite3, and environment setup",
  },
} satisfies WalletCommand;

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

/** `exists` is `null` when the path cannot be checked, such as under an unsearchable directory. */
type SessionStoreSection = { path: string; exists: boolean | null; readable: boolean };

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
      { path: channelsDbPath(), exists: null, readable: false },
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
  const network =
    flagNetwork ??
    envNetwork() ??
    unlessConfigInvalid(() => configValue("network", parseNetwork)) ??
    walletNetwork(state ?? emptyWalletState());

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
      // `walletNetwork` reads an unsupported stored chain as mainnet, so name both chains.
      `Wallet ${section.address} is logged in on ${section.network}, not ${networkName(network.chainId)}.`,
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

  // A damaged store can hold an expiry outside `Date`'s range, which `formatUnixTimestamp` throws on.
  const validExpiry =
    key.expiry === undefined || Number.isFinite(new Date(key.expiry * 1000).getTime());
  const section = {
    address: key.address.toLowerCase(),
    status: localAccessKeyStatus(key),
    expires_at: validExpiry ? formatUnixTimestamp(key.expiry) : null,
    spending_limits: await keySpendingLimits(key),
  };
  const name = `Access key ${section.address}`;
  if (!validExpiry)
    return result(
      "key",
      section,
      "fail",
      `${name} has an invalid expiry (${key.expiry}) in the wallet store. Run 'tempo wallet logout', then 'tempo wallet login'.`,
    );
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
  const url = rpcLabel(network);
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
        `RPC ${url} is on chain ${chainId}, not ${network.name} (${network.chainId}). ${rpcHint(network)}`,
      );
}

function rpcFailed(network: Network, reason: string): Result<RpcSection> {
  const url = rpcLabel(network);
  return result(
    "rpc",
    { url, ok: false, chain_id: null, chain_matches: null, latency_ms: null },
    "fail",
    `RPC ${url} ${reason}. ${rpcHint(network)}`,
  );
}

/** The redacted RPC URL; `<redacted>` while an invalid config file hides it. */
function rpcLabel(network: Network) {
  return unlessConfigInvalid(() => redactUrl(rpcUrl(network.chainId))) ?? redacted;
}

/** Why `eth_chainId` failed, without the error's own text, which can repeat the RPC URL. */
function rpcFailure(error: unknown, timeout: number) {
  if (error instanceof ConfigFileError)
    return "was not checked, since the config file is not valid";
  if (error instanceof TimeoutError) return `did not answer within ${timeout}ms`;
  if (error instanceof HttpRequestError)
    return error.status === undefined ? "could not be reached" : `answered HTTP ${error.status}`;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && code !== -1
    ? `answered with JSON-RPC error ${code}`
    : "did not return a chain ID";
}

function rpcHint(network: Network) {
  try {
    const override = rpcUrlOverride(network.chainId);
    if (override?.source === "env") return "Check TEMPO_RPC_URL.";
    return override
      ? `Check the rpc-url saved for ${network.name}.`
      : "Check your network connection.";
  } catch (error) {
    if (error instanceof ConfigFileError) return `Fix ${error.path}.`;
    throw error;
  }
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

/**
 * Whether the session database exists and can be read; the first session creates it. Only
 * `ENOENT` means it is absent: another error, such as a directory that cannot be searched, leaves
 * `exists` unknown and fails the check.
 */
async function sessionStoreCheck(): Promise<Result<SessionStoreSection>> {
  const path = channelsDbPath();
  const unreachable = await accessError(path, constants.F_OK);
  if (unreachable?.code === "ENOENT")
    return result(
      "session_store",
      { path, exists: false, readable: false },
      "ok",
      "No payment sessions are recorded yet.",
    );
  if (unreachable)
    return result(
      "session_store",
      { path, exists: null, readable: false },
      "fail",
      `The session store ${path} cannot be reached (${unreachable.code ?? "unknown error"}).`,
    );
  const readable = (await accessError(path, constants.R_OK)) === undefined;
  return readable
    ? result(
        "session_store",
        { path, exists: true, readable },
        "ok",
        "The session store is readable.",
      )
    : result(
        "session_store",
        { path, exists: true, readable },
        "fail",
        `The session store ${path} is not readable.`,
      );
}

/** The error `access` reports for `path`, or `undefined` when it allows `mode`. */
function accessError(path: string, mode: number) {
  return access(path, mode).then(
    () => undefined,
    (error: NodeJS.ErrnoException) => error,
  );
}

/**
 * Fails for an override that breaks other commands: an unknown network, a non-http(s) app URL, or
 * a config file that is not valid, with every saved setting checked.
 */
function envCheck(): Check {
  const authUrl = process.env.TEMPO_AUTH_URL;
  const config = configProblem();
  const problems = [
    ...(process.env.TEMPO_WALLET_NETWORK !== undefined && envNetwork() === null
      ? [
          "TEMPO_WALLET_NETWORK names no supported network, so other commands fail. Set it to mainnet or testnet, or unset it.",
        ]
      : []),
    ...(authUrl !== undefined && !isHttpUrl(authUrl)
      ? [
          "TEMPO_AUTH_URL is not an http(s) URL, so login and other wallet app requests fail. Set it to the wallet app URL, or unset it.",
        ]
      : []),
    ...(config ? [config] : []),
  ];
  if (problems.length) return { name: "env", status: "fail", message: problems.join(" ") };
  const set = Object.keys(envOverrides).filter((name) => process.env[name] !== undefined);
  return {
    name: "env",
    status: "ok",
    message: set.length ? `Overrides set: ${set.join(", ")}.` : "No overrides are set.",
  };
}

/** The error an invalid config file fails other commands with, if it does. */
function configProblem() {
  try {
    for (const key of configKeys) checkSetting(key);
    return undefined;
  } catch (error) {
    if (error instanceof ConfigFileError) return error.message;
    throw error;
  }
}

/** `read`'s value, or `undefined` when the config file is not valid, which `envCheck` reports. */
function unlessConfigInvalid<value>(read: () => value) {
  try {
    return read();
  } catch (error) {
    if (error instanceof ConfigFileError) return undefined;
    throw error;
  }
}

function isHttpUrl(value: string) {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
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
