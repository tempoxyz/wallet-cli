import { Cli } from "incur";

import { destructive, readOnly, type WalletCommand } from "../cli/command.js";
import { flag, positional } from "../cli/describe.js";
import {
  configChangeOptions,
  configGetArgs,
  configKeys,
  configOutput,
  configSetArgs,
  configSettings,
  configUnsetArgs,
  type ConfigKey,
} from "../schemas/config.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { commandError, usageError, type CommandContext } from "../shared/errors.js";
import { shellQuote } from "../shared/next.js";
import { canPrompt, confirm as confirmPrompt } from "../shared/process.js";
import {
  ConfigFileError,
  configValue,
  loadConfig,
  saveConfigValue,
  type Config,
  type ConfigSource,
} from "../wallet/config.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import { redactUrl } from "./doctor.js";

const yesArg = flag(
  "yes",
  "--yes",
  "Change the setting without the confirmation prompt; required for agent runs",
);

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
    // Piped stdin cannot answer the prompt, so such a run confirms like an agent's, with --yes.
    .command("set", {
      description: "Save a setting for later commands",
      args: configSetArgs,
      options: configChangeOptions,
      alias: globalAlias,
      output: configOutput,
      async run(context) {
        return configSetHandler(
          context.args.key,
          context.args.value,
          { ...context.globals, yes: context.options.yes },
          { ...context, agent: !canPrompt(context.agent) },
        );
      },
    })
    .command("unset", {
      description: "Remove a saved setting",
      args: configUnsetArgs,
      options: configChangeOptions,
      alias: globalAlias,
      output: configOutput,
      async run(context) {
        return configUnsetHandler(
          context.args.key,
          { ...context.globals, yes: context.options.yes },
          { ...context, agent: !canPrompt(context.agent) },
        );
      },
    }),
  annotations: {
    config_get: { ...readOnly, openWorldHint: false },
    // Saving or removing a setting can raise the spending cap, send RPC traffic to another server,
    // or switch the network later payments use; repeating it changes nothing more.
    config_set: { ...destructive, idempotentHint: true, openWorldHint: false },
    config_unset: { ...destructive, idempotentHint: true, openWorldHint: false },
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
          yesArg,
        ],
      },
      {
        name: "unset",
        about: "Remove a saved setting",
        args: [positional("key", configUnsetArgs.shape.key.description ?? ""), yesArg],
      },
    ],
  },
} satisfies WalletCommand;

type Flags = { network?: string | undefined };

type ChangeOptions = Flags & { yes?: boolean | undefined };

type Dependencies = { confirm?: (question: string) => Promise<boolean> };

type Setting = { value: string; source: ConfigSource };

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

/**
 * Checks `value` and saves it as `key` once the change is confirmed (see `confirmChange`), then
 * reports `key` as `configGetHandler` does. Saving the value already saved needs no confirmation.
 * Without `--yes`, the save applies only while `key` still holds the value the confirmation, or
 * the finding that nothing changes, was based on.
 */
export async function configSetHandler(
  key: string,
  value: string,
  options: ChangeOptions,
  context: CommandContext,
  dependencies: Dependencies = {},
) {
  const name = settingKey(key);
  const saved = configSettings[name].parse(value);
  const config = loadConfig();
  if (!options.yes && config[name] !== saved) {
    const change: Change = {
      action: "set",
      name,
      value: saved,
      config,
      next: { ...config, [name]: saved },
    };
    const refusal = await confirmChange(change, options, context, dependencies);
    if (refusal) return context.error(refusal);
  }
  const next = await saveConfigValue(name, saved, options.yes ? {} : { expected: config[name] });
  return await effectiveSettings([name], options, undefined, next);
}

/**
 * Removes the saved `key` once the removal is confirmed (see `confirmChange`), then reports `key`
 * as `configGetHandler` does. With nothing saved, there is nothing to confirm or remove. Without
 * `--yes`, the removal applies only while `key` still holds the value it was confirmed against.
 */
export async function configUnsetHandler(
  key: string,
  options: ChangeOptions,
  context: CommandContext,
  dependencies: Dependencies = {},
) {
  const name = settingKey(key);
  const config = loadConfig();
  if (!options.yes && config[name] !== undefined) {
    const { [name]: _removed, ...next } = config;
    const change: Change = { action: "unset", name, value: undefined, config, next };
    const refusal = await confirmChange(change, options, context, dependencies);
    if (refusal) return context.error(refusal);
  }
  const next = await saveConfigValue(
    name,
    undefined,
    options.yes ? {} : { expected: config[name] },
  );
  return await effectiveSettings([name], options, undefined, next);
}

type Change = {
  action: "set" | "unset";
  name: ConfigKey;
  /** The value `set` saves. */
  value: string | undefined;
  /** The settings now, and the settings the change leaves. */
  config: Config;
  next: Config;
};

/**
 * Confirms `change`, since a setting decides what later payments and RPC calls use: a run that can
 * prompt shows the setting's value before and after and asks on the terminal, and any other run
 * changes nothing and gets the refusal to return, whose `cta` is the same command plus `--yes`. A
 * declined prompt throws.
 */
async function confirmChange(
  change: Change,
  options: ChangeOptions,
  context: CommandContext,
  { confirm = confirmPrompt }: Dependencies,
) {
  const setting = configSettings[change.name];
  const state = await loadWalletState();
  const [before, after] = await Promise.all([
    describeSetting(change.name, options, state, change.config),
    describeSetting(change.name, options, state, change.next),
  ]);
  const warning = change.action === "set" && "warning" in setting ? setting.warning : undefined;
  const value = change.value === undefined ? undefined : shown(change.name, change.value);
  const verb = change.action === "set" ? "Save" : "Remove";
  if (context.agent) {
    // A cta ends up in agent context and logs, so a value that can carry a credential stays out
    // of it. Its placeholder fails `parse`, so running the cta unchanged saves nothing.
    const redacted = value !== change.value;
    const placeholder = `<${change.name}>`;
    const argument = value === undefined ? [] : [redacted ? placeholder : value];
    const command = ["tempo", "wallet", "config", change.action, change.name, ...argument, "--yes"]
      .map(shellQuote)
      .join(" ");
    const fill = redacted
      ? ` Replace ${placeholder} with the full ${change.name}, which is left out since it can carry a credential.`
      : "";
    return commandError(
      "E_USAGE",
      `${change.action === "set" ? "Saving" : "Removing"} ${change.name} changes what later commands use, so it needs confirmation: it goes from ${before} to ${after}.${warning ? ` ${warning}` : ""} Run '${command}' to confirm.${fill}`,
      command,
    );
  }
  const question = [
    `${verb} ${change.name}${value === undefined ? "" : ` ${value}`}`,
    `  now:   ${before}`,
    `  after: ${after}`,
    ...(warning ? [warning] : []),
    `${verb} this setting?`,
  ].join("\n");
  if (!(await confirm(question)))
    throw usageError(
      `${change.name} not ${change.action === "set" ? "saved" : "removed"}: not confirmed at the prompt`,
    );
  return undefined;
}

/** `name`'s effective value under `config` and where it comes from, as the prompt shows it. */
async function describeSetting(name: ConfigKey, flags: Flags, state: WalletState, config: Config) {
  try {
    const { value, source } = await configSettings[name].effective(flags.network, state, config);
    return `${shown(name, value)} (${source})`;
  } catch (error) {
    // The change replaces or removes a saved value the config file holds but cannot apply.
    if (error instanceof ConfigFileError) return "an invalid saved value";
    throw error;
  }
}

/** `keys` as `config` (by default, `loadConfig`'s) leaves them; `set` passes what it saved. */
async function effectiveSettings(
  keys: readonly ConfigKey[],
  flags: Flags,
  state?: WalletState,
  config?: Config,
) {
  const settings = await Promise.all(
    keys.map(async (key) => {
      const { value, source } = await configSettings[key].effective(flags.network, state, config);
      return [key, { value: shown(key, value), source }] as const;
    }),
  );
  return Object.fromEntries(settings) as Partial<Record<ConfigKey, Setting>>;
}

/** `value` as output shows it: redacted for a setting whose value can carry a credential. */
function shown(key: ConfigKey, value: string) {
  const setting = configSettings[key];
  return "redact" in setting && setting.redact ? redactUrl(value) : value;
}

function settingKey(key: string): ConfigKey {
  if (Object.hasOwn(configSettings, key)) return key as ConfigKey;
  throw usageError(`Unknown config key: ${key}. Valid keys: ${configKeys.join(", ")}`);
}
