import { z } from "incur";

import { maxSpendSetting, parseMaxSpend } from "../request/spend.js";
import {
  networkSetting,
  parseNetwork,
  parseRpcUrl,
  rpcUrl,
  rpcUrlOverride,
} from "../shared/network.js";
import type { Config, ConfigSource } from "../wallet/config.js";
import type { WalletState } from "../wallet/store.js";
import { globalOptionShape } from "./shared.js";

type Setting = { value: string; source: ConfigSource };

/**
 * The settings `tempo wallet config` saves, by name, each with the environment variable that
 * overrides it. `parse` checks a value and returns what is saved. `effective` is the value a
 * command with `flag` as its `--network` uses, and where it came from, from the resolver that
 * applies the setting to `config` (by default, the config file). `redact` shows the value as
 * `doctor` shows a URL, since an RPC URL can carry an API key. `warning` is what saving a new
 * value also does, shown before it is confirmed. A new setting is one entry here, read with
 * `configValue` in its resolver.
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
    about: "an http(s) URL that serves every network",
    env: "TEMPO_RPC_URL",
    parse: parseRpcUrl,
    async effective(flag: string | undefined, state?: WalletState, config?: Config) {
      const override = rpcUrlOverride(config);
      if (override) return override;
      const { network } = await networkSetting(flag, state, config);
      return { value: rpcUrl(network.chainId, config), source: "default" as const };
    },
    redact: true,
    warning:
      "The new rpc-url will receive all of the CLI's RPC traffic on every network, including balance and channel reads.",
  },
  "max-spend": {
    about: "a positive amount in payment token units",
    env: "TEMPO_MAX_SPEND",
    parse: parseMaxSpend,
    effective: (_flag: string | undefined, _state?: WalletState, config?: Config) =>
      maxSpendSetting(undefined, config),
  },
} satisfies Record<
  string,
  {
    about: string;
    env: string;
    parse: (value: string) => string;
    effective: (
      flag: string | undefined,
      state?: WalletState,
      config?: Config,
    ) => Setting | Promise<Setting>;
    redact?: boolean;
    warning?: string;
  }
>;

export type ConfigKey = keyof typeof configSettings;

export const configKeys = Object.keys(configSettings) as ConfigKey[];

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

/** Each setting asked for, by name, with its effective value and where it comes from. */
export const configOutput = z.object(
  Object.fromEntries(configKeys.map((key) => [key, settingOutput.optional()])) as Record<
    ConfigKey,
    z.ZodOptional<typeof settingOutput>
  >,
);
