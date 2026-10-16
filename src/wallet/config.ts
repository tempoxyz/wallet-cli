import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { Errors } from "incur";

import { withFileLock } from "../payment/session-lock.js";
import type { ConfigKey } from "../schemas/config.js";
import { errorCodes, walletError } from "../shared/errors.js";
import { ensurePrivateWalletDirectory, writePrivateFile } from "./store.js";

/**
 * Where a setting's effective value comes from: the command's flag, its environment variable, the
 * config file, the logged-in wallet (`network` only), or the built-in default.
 */
export type ConfigSource = "flag" | "env" | "config" | "login" | "default";

/** The config file's settings by name, as `loadConfig` reads them. */
export type Config = Readonly<Record<string, unknown>>;

/**
 * The settings `tempo wallet config set` saves: a JSON object by setting name, each a string or,
 * for a setting saved per network such as `rpc-url`, an object of strings by network name. Names
 * this version does not know, as a newer one may save, are kept and ignored.
 */
export function configPath() {
  return join(homedir(), ".tempo", "wallet", "config.json");
}

/**
 * The saved value of `key` in `config`, checked with `parse`; `undefined` when it is not set.
 * `config` is `loadConfig`'s unless a caller passes the settings a change would leave. A file that
 * is not a JSON object, or a value `parse` rejects, fails with `ConfigFileError`.
 */
export function configValue<value>(
  key: ConfigKey,
  parse: (value: string) => value,
  config: Config = loadConfig(),
) {
  return savedString(key, config[key], parse, `tempo wallet config unset ${key}`);
}

/**
 * The value of `key` saved for `network` in `config`, checked with `parse`, for a setting saved
 * per network; `undefined` when it is not set for `network`. A saved value that is not an object
 * of strings by network fails with `ConfigFileError`, as an invalid entry for `network` does.
 */
export function networkConfigValue<value>(
  key: ConfigKey,
  network: string,
  parse: (value: string) => value,
  config: Config = loadConfig(),
) {
  const saved = config[key];
  if (saved === undefined) return undefined;
  if (!isRecord(saved))
    throw invalidSetting(key, "expected an object by network", `tempo wallet config unset ${key}`);
  return savedString(
    `${key} for ${network}`,
    saved[network],
    parse,
    `tempo wallet config unset ${key} --network ${network}`,
  );
}

function savedString<value>(
  name: string,
  saved: unknown,
  parse: (value: string) => value,
  unset: string,
) {
  if (saved === undefined) return undefined;
  if (typeof saved !== "string") throw invalidSetting(name, "expected a string", unset);
  try {
    return parse(saved);
  } catch (error) {
    throw invalidSetting(name, error instanceof Error ? error.message : String(error), unset);
  }
}

function invalidSetting(name: string, reason: string, unset: string) {
  return new ConfigFileError(
    `has an invalid ${name} (${reason})`,
    `Run '${unset}', or fix the file.`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Saves `value` as `key`, or for a setting saved per network as `network`'s entry of it, or removes
 * it when `value` is `undefined`, keeping every other setting and network as the file holds them.
 * Each change rewrites the whole file, so changes hold the config lock and apply to the file as
 * it is under it, never to an earlier read, which keeps concurrent ones from overwriting each
 * other; `writePrivateFile` replaces it atomically, readable only by the owner. With `expected`,
 * the change applies only while the value it changes still is `expected` (`undefined` when it is
 * not set), checked under the lock, so a change decided on one value is never applied over
 * another; otherwise nothing is written and it fails with a retryable `E_USAGE`.
 */
export async function saveConfigValue(
  key: ConfigKey,
  value: string | undefined,
  options: { network?: string | undefined; expected?: unknown } = {},
): Promise<Config> {
  const path = configPath();
  await ensurePrivateWalletDirectory(path);
  return await withFileLock(join(dirname(path), "config.lock"), "config lock", async () => {
    // Read the file itself, not the command's snapshot: this is the value the change replaces.
    const config = readConfigFile();
    const { [key]: saved, ...others } = config;
    const { network } = options;
    // A value that is not an object of networks holds none, and the change replaces it.
    const entries = network === undefined ? undefined : isRecord(saved) ? saved : {};
    const current = network === undefined ? saved : entries?.[network];
    if ("expected" in options && !isDeepStrictEqual(current, options.expected))
      throw walletError({
        code: "E_USAGE",
        message: `${network === undefined ? key : `${key} for ${network}`} changed in ${path} while this command ran, so nothing was changed. Rerun the command to review the new value.`,
        retryable: true,
      });
    if (current === value && (network === undefined || entries === saved)) return config;
    let next: unknown = value;
    if (network !== undefined) {
      const { [network]: _changed, ...otherNetworks } = entries ?? {};
      const nextEntries = value === undefined ? otherNetworks : { ...entries, [network]: value };
      next = Object.keys(nextEntries).length > 0 ? nextEntries : undefined;
    }
    const written = next === undefined ? others : { ...config, [key]: next };
    await writePrivateFile(path, JSON.stringify(written, null, 2));
    return written;
  });
}

/** Each running command's view of the config file, and what it found once; see `withConfigSnapshot`. */
const snapshots = new AsyncLocalStorage<{
  read?: { config: Config } | { error: unknown };
  cached: Map<string, unknown>;
}>();

/**
 * Runs `fn`, one command, with one view of the config file: its first read is kept for every later
 * read in `fn`, so the command resolves `network`, `rpc-url`, and `max-spend` once, and a chain
 * check and the reads it vouches for use the same endpoint. A change another process saves
 * meanwhile applies to the next command.
 */
export function withConfigSnapshot<result>(fn: () => result) {
  return snapshots.run({ cached: new Map() }, fn);
}

/**
 * `compute`'s value for `key`, computed once per command (see `withConfigSnapshot`), such as what
 * the command's one RPC endpoint reports; outside a command, computed on every call.
 */
export function commandCached<value>(key: string, compute: () => value): value {
  const cached = snapshots.getStore()?.cached;
  if (!cached) return compute();
  if (!cached.has(key)) cached.set(key, compute());
  return cached.get(key) as value;
}

/** incur middleware that runs each command, a CLI run or an MCP tool call, in `withConfigSnapshot`. */
export async function configSnapshot(_context: unknown, next: () => Promise<void>) {
  await withConfigSnapshot(next);
}

/**
 * The config file's settings, none when it does not exist: as the running command first read
 * them (see `withConfigSnapshot`), else as the file holds them now.
 */
export function loadConfig(): Config {
  const snapshot = snapshots.getStore();
  if (!snapshot) return readConfigFile();
  if (!snapshot.read)
    try {
      snapshot.read = { config: readConfigFile() };
    } catch (error) {
      snapshot.read = { error };
    }
  if ("error" in snapshot.read) throw snapshot.read.error;
  return snapshot.read.config;
}

function readConfigFile(): Config {
  let text: string;
  try {
    text = readFileSync(configPath(), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw new ConfigFileError(`could not be read (${code ?? "unknown error"})`, unreadableFix);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigFileError("is not valid JSON", unreadableFix);
  }
  if (!isRecord(value)) throw new ConfigFileError("is not a JSON object", unreadableFix);
  return value;
}

const unreadableFix = "Fix it, or delete it to clear every setting.";

/**
 * The config file cannot be read, is not a JSON object, or holds an invalid setting. It is a usage
 * error naming the file and how to fix it, since only the user can repair a hand-edited file.
 */
export class ConfigFileError extends Errors.IncurError {
  /** The config file. */
  readonly path: string;

  constructor(problem: string, fix: string) {
    const path = configPath();
    const { exitCode, retryable } = errorCodes.E_USAGE;
    super({
      code: "E_USAGE",
      exitCode,
      retryable,
      message: `Config file ${path} ${problem}. ${fix}`,
    });
    this.path = path;
  }
}
