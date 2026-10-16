import { z } from "incur";

import { maxSpendSetting, parseMaxSpend } from "../request/spend.js";
import {
  networkSetting,
  parseNetwork,
  parseRpcUrl,
  rpcUrl,
  rpcUrlOverride,
} from "../shared/network.js";
import type { ConfigSource } from "../wallet/config.js";
import type { WalletState } from "../wallet/store.js";

type Setting = { value: string; source: ConfigSource };

/**
 * The settings `tempo wallet config` saves, by name, each with the environment variable that
 * overrides it. `parse` checks a value and returns what is saved. `effective` is the value a
 * command with `flag` as its `--network` uses, and where it came from, from the resolver that
 * applies the setting. `redact` shows the value as `doctor` shows a URL, since an RPC URL can
 * carry an API key. A new setting is one entry here, read with `configValue` in its resolver.
 */
export const configSettings = {
  network: {
    about: "mainnet or testnet",
    env: "TEMPO_WALLET_NETWORK",
    parse: (value: string) => parseNetwork(value).name,
    async effective(flag: string | undefined, state?: WalletState): Promise<Setting> {
      const { network, source } = await networkSetting(flag, state);
      return { value: network.name, source };
    },
  },
  "rpc-url": {
    about: "an http(s) URL that serves every network",
    env: "TEMPO_RPC_URL",
    parse: parseRpcUrl,
    async effective(flag: string | undefined, state?: WalletState): Promise<Setting> {
      const override = rpcUrlOverride();
      if (override) return override;
      const { network } = await networkSetting(flag, state);
      return { value: rpcUrl(network.chainId), source: "default" };
    },
    redact: true,
  },
  "max-spend": {
    about: "a positive amount in payment token units",
    env: "TEMPO_MAX_SPEND",
    parse: parseMaxSpend,
    effective: (): Setting => maxSpendSetting(),
  },
} satisfies Record<
  string,
  {
    about: string;
    env: string;
    parse: (value: string) => string;
    effective: (flag: string | undefined, state?: WalletState) => Setting | Promise<Setting>;
    redact?: boolean;
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
