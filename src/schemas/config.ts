import { z } from "incur";

import { maxSpendSetting, parseMaxSpend } from "../request/spend.js";
import {
  networkSetting,
  networks,
  parseNetwork,
  parseRpcUrl,
  rpcUrl,
  rpcUrlOverride,
  verifyRpcUrl,
  type Network,
} from "../shared/network.js";
import {
  configValue,
  networkConfigValue,
  type Config,
  type ConfigSource,
} from "../wallet/config.js";
import type { WalletState } from "../wallet/store.js";
import { globalOptionShape } from "./shared.js";

type Setting = { value: string; source: ConfigSource };

/** A setting saved once for every network. */
type SharedSetting = {
  about: string;
  env: string;
  parse: (value: string) => string;
  /** The value a command run with `flag` as its `--network` uses under `config`, and its source. */
  effective: (
    flag: string | undefined,
    state?: WalletState,
    config?: Config,
  ) => Setting | Promise<Setting>;
  redact?: boolean;
  warning?: string;
};

/**
 * A setting saved for one network at a time, the network `set` and `unset` resolve (`--network`,
 * else the one commands use); `verify` checks a value against that network before it is saved.
 */
type NetworkSetting = Omit<SharedSetting, "effective"> & {
  perNetwork: true;
  /** The value `network`'s commands use under `config`, and its source. */
  effective: (network: Network, config?: Config) => Setting;
  /** Checks `value` on `network`, returning the chain it verified, or throws `E_USAGE`. */
  verify: (value: string, network: Network) => Promise<number>;
};

/**
 * The settings `tempo wallet config` saves, by name, each with the environment variable that
 * overrides it. `parse` checks a value and returns what is saved. `effective` is the value a
 * command uses and where it came from, from the resolver that applies the setting to `config` (by
 * default, the config file). `redact` shows the value as `doctor` shows a URL, since an RPC URL
 * can carry an API key. `warning` is what saving a new value also does, shown before it is
 * confirmed. A new setting is one entry here, read with `configValue`, or `networkConfigValue`
 * for a setting saved per network, in its resolver.
 */
export const configSettings = {
  network: {
    about: "mainnet or testnet",
    env: "TEMPO_WALLET_NETWORK",
    parse: (value: string) => parseNetwork(value).name,
    async effective(flag: string | undefined, state?: WalletState, config?: Config) {
      const { network, source } = await networkSetting(flag, state, config);
      return { value: network.name, source };
    },
  },
  "rpc-url": {
    about:
      "an http(s) URL for one network (--network, else the network commands use) that answers eth_chainId with its chain",
    env: "TEMPO_RPC_URL",
    perNetwork: true,
    parse: parseRpcUrl,
    effective: (network: Network, config?: Config): Setting =>
      rpcUrlOverride(network.chainId, config) ?? {
        value: rpcUrl(network.chainId, config),
        source: "default",
      },
    verify: verifyRpcUrl,
    redact: true,
    warning:
      "The new rpc-url will receive all of the CLI's RPC traffic on that network, including balance and channel reads.",
  },
  "max-spend": {
    about:
      "a positive amount in payment token units, or in MACH (1 MACH = 1 USD) for a MACH payment",
    env: "TEMPO_MAX_SPEND",
    parse: parseMaxSpend,
    effective: (_flag: string | undefined, _state?: WalletState, config?: Config) =>
      maxSpendSetting(undefined, config),
  },
} satisfies Record<string, SharedSetting | NetworkSetting>;

export type ConfigKey = keyof typeof configSettings;

export const configKeys = Object.keys(configSettings) as ConfigKey[];

/** Fails with `ConfigFileError` when the value of `key` saved in `config` is not valid. */
export function checkSetting(key: ConfigKey, config?: Config) {
  const setting = configSettings[key];
  if ("perNetwork" in setting)
    for (const network of networks) networkConfigValue(key, network.name, setting.parse, config);
  else configValue(key, setting.parse, config);
}

const keyList = configKeys.join(", ");

export const configGetArgs = z.object({
  key: z.string().optional().describe(`Setting: ${keyList}; every setting when omitted`),
});

export const configSetArgs = z.object({
  key: z.string().describe(`Setting: ${keyList}`),
  value: z
    .string()
    .describe(
      `Value to save. ${configKeys.map((key) => `${key}: ${configSettings[key].about}`).join("; ")}`,
    ),
});

export const configUnsetArgs = z.object({
  key: z.string().describe(`Setting: ${keyList}`),
});

/** `set` and `unset` change what later payments and RPC calls use, so they need confirmation. */
export const configChangeOptions = z.object({
  ...globalOptionShape,
  yes: z
    .boolean()
    .optional()
    .describe("Change the setting without the confirmation prompt; required for agent runs"),
});

const settingOutput = z.object({
  value: z
    .string()
    .describe("The value commands use; rpc-url shows only its scheme, host, and port"),
  source: z
    .enum(["flag", "env", "config", "login", "default"])
    .describe(
      `Where the value comes from. flag: --network. env: ${configKeys.map((key) => configSettings[key].env).join(", ")}. config: the config file. login: the logged-in wallet's network. default: the built-in default`,
    ),
});

const networkSettingOutput = z
  .object(
    Object.fromEntries(networks.map(({ name }) => [name, settingOutput])) as Record<
      Network["name"],
      typeof settingOutput
    >,
  )
  .describe("The setting on each network");

/**
 * Each setting asked for, by name, with its effective value and where it comes from; a setting
 * saved per network has one for each network.
 */
export const configOutput = z.object(
  Object.fromEntries(
    configKeys.map((key) => [
      key,
      ("perNetwork" in configSettings[key] ? networkSettingOutput : settingOutput).optional(),
    ]),
  ) as Record<ConfigKey, z.ZodOptional<typeof settingOutput | typeof networkSettingOutput>>,
);
