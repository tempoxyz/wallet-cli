import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Errors } from "incur";

import { withFileLock } from "../payment/session-lock.js";
import type { ConfigKey } from "../schemas/config.js";
import { errorCodes } from "../shared/errors.js";
import { ensurePrivateWalletDirectory, writePrivateFile } from "./store.js";

/**
 * Where a setting's effective value comes from: the command's flag, its environment variable, the
 * config file, the logged-in wallet (`network` only), or the built-in default.
 */
export type ConfigSource = "flag" | "env" | "config" | "login" | "default";

/**
 * The settings `tempo wallet config set` saves: a JSON object of strings by setting name. Names
 * this version does not know, as a newer one may save, are kept and ignored.
 */
export function configPath() {
  return join(homedir(), ".tempo", "wallet", "config.json");
}

/**
 * The saved value of `key`, checked with `parse`; `undefined` when it is not set. Each read sees
 * the file as it is now, so a long-running MCP server follows changes from other processes. A file
 * that is not a JSON object, or a value `parse` rejects, fails with `ConfigFileError`.
 */
export function configValue<value>(key: ConfigKey, parse: (value: string) => value) {
  const saved = readConfig()[key];
  if (saved === undefined) return undefined;
  const invalid = (reason: string) =>
    new ConfigFileError(
      `has an invalid ${key} (${reason})`,
      `Run 'tempo wallet config unset ${key}', or fix the file.`,
    );
  if (typeof saved !== "string") throw invalid("expected a string");
  try {
    return parse(saved);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Saves `value` as `key`, or removes `key` when `value` is `undefined`, keeping the other settings.
 * Each change rewrites the whole file, so changes hold the config lock to keep concurrent ones
 * from overwriting each other; `writePrivateFile` replaces it atomically, readable only by the
 * owner.
 */
export async function saveConfigValue(key: ConfigKey, value: string | undefined) {
  const path = configPath();
  await ensurePrivateWalletDirectory(path);
  await withFileLock(join(dirname(path), "config.lock"), "config lock", async () => {
    const config = readConfig();
    const { [key]: saved, ...others } = config;
    if (value === undefined && saved === undefined) return;
    const next = value === undefined ? others : { ...config, [key]: value };
    await writePrivateFile(path, JSON.stringify(next, null, 2));
  });
}

/** The config file's settings; none when it does not exist. */
function readConfig(): Record<string, unknown> {
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
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConfigFileError("is not a JSON object", unreadableFix);
  return value as Record<string, unknown>;
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
