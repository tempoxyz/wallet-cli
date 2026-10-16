import { Cli } from "incur";

import { nonDestructive, readOnly, type WalletCommand } from "../cli/command.js";
import { positional } from "../cli/describe.js";
import {
  configGetArgs,
  configKeys,
  configOutput,
  configSetArgs,
  configSettings,
  configUnsetArgs,
  type ConfigKey,
} from "../schemas/config.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { usageError } from "../shared/errors.js";
import { configValue, saveConfigValue, type ConfigSource } from "../wallet/config.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import { redactUrl } from "./doctor.js";

// Mounted groups share the root globals; declaring them types `globals` in their commands.
export default {
  command: Cli.create("config", {
    description: "Read and write persistent CLI settings",
    globals: cliGlobals,
  })
    .command("get", {
      description: "Show each setting's effective value and where it comes from",
      args: configGetArgs,
      options: globalOptions,
      alias: globalAlias,
      output: configOutput,
      async run({ args, globals }) {
        return configGetHandler(args.key, globals);
      },
    })
    .command("set", {
      description: "Save a setting for later commands",
      args: configSetArgs,
      options: globalOptions,
      alias: globalAlias,
      output: configOutput,
      async run({ args, globals }) {
        return configSetHandler(args.key, args.value, globals);
      },
    })
    .command("unset", {
      description: "Remove a saved setting",
      args: configUnsetArgs,
      options: globalOptions,
      alias: globalAlias,
      output: configOutput,
      async run({ args, globals }) {
        return configUnsetHandler(args.key, globals);
      },
    }),
  annotations: {
    config_get: { ...readOnly, openWorldHint: false },
    // Saving or removing a setting changes only the local config file, and repeating it changes
    // nothing more.
    config_set: { ...nonDestructive, idempotentHint: true, openWorldHint: false },
    config_unset: { ...nonDestructive, idempotentHint: true, openWorldHint: false },
  },
  describe: {
    name: "config",
    about: "Read and write persistent CLI settings",
    subcommands: [
      {
        name: "get",
        about: "Show each setting's effective value and where it comes from",
        args: [positional("key", configGetArgs.shape.key.description ?? "")],
      },
      {
        name: "set",
        about: "Save a setting for later commands",
        args: [
          positional("key", configSetArgs.shape.key.description ?? ""),
          positional("value", configSetArgs.shape.value.description ?? ""),
        ],
      },
      {
        name: "unset",
        about: "Remove a saved setting",
        args: [positional("key", configUnsetArgs.shape.key.description ?? "")],
      },
    ],
  },
} satisfies WalletCommand;

type Flags = { network?: string | undefined };

/**
 * Every setting, or only `key`, with the value a command run with `flags` uses and where it comes
 * from. Each setting shown is checked in the config file, even one its environment variable
 * overrides, so a bad saved value is reported before it is needed.
 */
export async function configGetHandler(key: string | undefined, flags: Flags = {}) {
  const keys = key === undefined ? configKeys : [settingKey(key)];
  for (const name of keys) configValue(name, configSettings[name].parse);
  return await effectiveSettings(keys, flags, await loadWalletState());
}

/** Checks `value` and saves it as `key`, then reports `key` as `configGetHandler` does. */
export async function configSetHandler(key: string, value: string, flags: Flags = {}) {
  const name = settingKey(key);
  await saveConfigValue(name, configSettings[name].parse(value));
  return await effectiveSettings([name], flags);
}

/** Removes the saved `key`, if any, then reports `key` as `configGetHandler` does. */
export async function configUnsetHandler(key: string, flags: Flags = {}) {
  const name = settingKey(key);
  await saveConfigValue(name, undefined);
  return await effectiveSettings([name], flags);
}

async function effectiveSettings(keys: readonly ConfigKey[], flags: Flags, state?: WalletState) {
  const settings = await Promise.all(
    keys.map(async (key) => {
      const setting = configSettings[key];
      const { value, source } = await setting.effective(flags.network, state);
      const shown = "redact" in setting && setting.redact ? redactUrl(value) : value;
      return [key, { value: shown, source }] as const;
    }),
  );
  return Object.fromEntries(settings) as Partial<
    Record<ConfigKey, { value: string; source: ConfigSource }>
  >;
}

function settingKey(key: string): ConfigKey {
  if (Object.hasOwn(configSettings, key)) return key as ConfigKey;
  throw usageError(`Unknown config key: ${key}. Valid keys: ${configKeys.join(", ")}`);
}
