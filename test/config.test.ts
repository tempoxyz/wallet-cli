import { execFile, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { balanceHandler } from "../src/commands/balance.js";
import { configGetHandler, configSetHandler, configUnsetHandler } from "../src/commands/config.js";
import { keysHandler } from "../src/commands/keys.js";
import { logoutHandler } from "../src/commands/logout.js";
import { whoamiHandler } from "../src/commands/whoami.js";
import { parseRequestArgs } from "../src/request/args.js";
import { resolvePaymentNetwork } from "../src/request/identity.js";
import { defaultMaxSpend, maxSpendSetting, resolveMaxSpend } from "../src/request/spend.js";
import { configKeys, configSettings, type ConfigKey } from "../src/schemas/config.js";
import {
  explicitNetwork,
  networkSetting,
  resolveNetwork,
  rpcUrl,
  rpcUrlOverride,
} from "../src/shared/network.js";
import {
  configPath,
  saveConfigValue,
  withConfigSnapshot,
  type ConfigSource,
} from "../src/wallet/config.js";
import { rpcChainCheck } from "../src/wallet/key-output.js";
import { loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import { readyWallet, runContext, testPrivateKey, useTempHome, walletState } from "./helpers.js";

const race = vi.hoisted(() => ({ afterRead: undefined as (() => void) | undefined }));

// Lets a test change the config file just after a command reads it, as another process could.
// The store's own reads, under the config lock, are not affected.
vi.mock("../src/wallet/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/wallet/config.js")>();
  return {
    ...actual,
    loadConfig: () => {
      const config = actual.loadConfig();
      const afterRead = race.afterRead;
      race.afterRead = undefined;
      afterRead?.();
      return config;
    },
  };
});

const execFileAsync = promisify(execFile);

const mainnetRpc = "https://rpc.mainnet.tempo.xyz";
const moderatoRpc = "https://rpc.moderato.tempo.xyz";
const testnetKey = { ...walletState().accessKeys[0]!, chainId: 42431 };

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  vi.stubEnv("TEMPO_MAX_SPEND", undefined);
  vi.stubEnv("TEMPO_PRIVATE_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The config file as saved, or `undefined` when there is none. */
async function savedConfig() {
  const text = await readFile(configPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

async function writeConfig(body: string) {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), body);
}

/** `config set` with `--yes`, so it needs no prompt. */
function confirmedSet(key: string, value: string, network?: string) {
  return configSetHandler(key, value, { network, yes: true }, runContext());
}

/** `config unset` with `--yes`, so it needs no prompt. */
function confirmedUnset(key: string) {
  return configUnsetHandler(key, { yes: true }, runContext());
}

describe("config set, get, and unset", () => {
  it.each([
    {
      key: "network",
      input: "moderato",
      saved: "testnet",
      fallback: { value: "mainnet", source: "default" },
    },
    {
      key: "rpc-url",
      input: "http://127.0.0.1:8545",
      saved: "http://127.0.0.1:8545",
      fallback: { value: mainnetRpc, source: "default" },
    },
    {
      key: "max-spend",
      input: "2.5",
      saved: "2.5",
      fallback: { value: defaultMaxSpend, source: "default" },
    },
  ] as const)("saves, reports, and removes $key", async ({ key, input, saved, fallback }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    const configured = { [key]: { value: saved, source: "config" } };

    expect(await confirmedSet(key, input)).toEqual(configured);
    expect(await savedConfig()).toEqual({ [key]: saved });
    expect(await configGetHandler(key)).toEqual(configured);
    expect(await confirmedSet(key, input)).toEqual(configured);
    expect(await savedConfig()).toEqual({ [key]: saved });

    expect(await confirmedUnset(key)).toEqual({ [key]: fallback });
    expect(await savedConfig()).toEqual({});
    expect(await confirmedUnset(key)).toEqual({ [key]: fallback });
    expect(await savedConfig()).toEqual({});
  });

  it.each([
    { key: "network", value: "typo", message: "Unsupported network: typo" },
    { key: "network", value: "", message: "Unsupported network: " },
    { key: "network", value: "Mainnet", message: "Unsupported network: Mainnet" },
    { key: "rpc-url", value: "rpc.example.com", message: "rpc-url must be an http(s) URL" },
    { key: "rpc-url", value: "ftp://rpc.example.com", message: "rpc-url must be an http(s) URL" },
    { key: "rpc-url", value: "file:///etc/hosts", message: "rpc-url must be an http(s) URL" },
    { key: "rpc-url", value: "", message: "rpc-url must be an http(s) URL" },
    ...["0", "0.000000", "-1", "1.0000001", "1e3", "abc", " 5", ""].map((value) => ({
      key: "max-spend",
      value,
      message: "max-spend must be a positive amount with at most 6 decimal places",
    })),
  ])("refuses $key $value without saving it", async ({ key, value, message }) => {
    await useTempHome();
    await saveConfigValue("max-spend", "3");

    await expect(confirmedSet(key, value)).rejects.toMatchObject({
      code: "E_USAGE",
      exitCode: 2,
      message,
    });
    expect(await savedConfig()).toEqual({ "max-spend": "3" });
  });

  it.each(["0.000001", "1", "10.5", "1000000.123456"])("saves max-spend %s", async (value) => {
    await useTempHome();

    expect(await confirmedSet("max-spend", value)).toEqual({
      "max-spend": { value, source: "config" },
    });
  });

  it.each([
    { command: "get", run: (key: string) => configGetHandler(key) },
    { command: "set", run: (key: string) => confirmedSet(key, "5") },
    { command: "unset", run: (key: string) => confirmedUnset(key) },
  ])("config $command refuses an unknown key, listing the valid ones", async ({ run }) => {
    await useTempHome();

    for (const key of ["max_spend", "rpc", "toString", "__proto__"])
      await expect(run(key)).rejects.toMatchObject({
        code: "E_USAGE",
        exitCode: 2,
        message: `Unknown config key: ${key}. Valid keys: network, rpc-url, max-spend`,
      });
    expect(await savedConfig()).toBeUndefined();
  });

  it.each([
    {
      state: "logged out",
      chainId: undefined,
      expected: {
        network: { value: "mainnet", source: "default" },
        "rpc-url": { value: mainnetRpc, source: "default" },
        "max-spend": { value: "10", source: "default" },
      },
    },
    {
      state: "logged in on testnet",
      chainId: 42431,
      expected: {
        network: { value: "testnet", source: "login" },
        "rpc-url": { value: moderatoRpc, source: "default" },
        "max-spend": { value: "10", source: "default" },
      },
    },
  ])("config get reports every setting when $state", async ({ chainId, expected }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    if (chainId) await saveWalletState(walletState({ chainId }));

    expect(await configGetHandler(undefined)).toEqual(expected);
    expect(Object.keys(await configGetHandler(undefined))).toEqual([
      "network",
      "rpc-url",
      "max-spend",
    ]);
  });

  it("shows a saved rpc-url without its credentials, but saves it whole", async () => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    const url = "https://user:secret@rpc.example.com/v2/apikey?token=abc";
    const shown = {
      "rpc-url": {
        value: "https://<redacted>@rpc.example.com/<redacted>?<redacted>",
        source: "config",
      },
    };

    expect(await confirmedSet("rpc-url", url)).toEqual(shown);
    expect(await configGetHandler("rpc-url")).toEqual(shown);
    expect(await savedConfig()).toEqual({ "rpc-url": url });
    expect(rpcUrl(4217)).toBe(url);
  });
});

describe("confirming a change", () => {
  const setting = (value: string, source: ConfigSource) => ({ value, source });
  const label = ({ value, source }: { value: string; source: ConfigSource }) =>
    `${value} (${source})`;
  const changes = [
    {
      key: "network",
      saved: "mainnet",
      value: "testnet",
      before: setting("mainnet", "config"),
      set: setting("testnet", "config"),
      unset: setting("testnet", "login"),
    },
    {
      key: "rpc-url",
      saved: "https://old.example.com",
      value: "https://rpc.example.com/v2/apikey",
      // Output never shows the URL's path, which can carry an API key, and the cta leaves it out.
      shown: "https://rpc.example.com/<redacted>",
      placeholder: "<rpc-url>",
      before: setting("https://old.example.com", "config"),
      set: setting("https://rpc.example.com/<redacted>", "config"),
      unset: setting(moderatoRpc, "default"),
      warning:
        "The new rpc-url will receive all of the CLI's RPC traffic on every network, including balance and channel reads.",
    },
    {
      key: "max-spend",
      saved: "5",
      value: "50",
      before: setting("5", "config"),
      set: setting("50", "config"),
      unset: setting("10", "default"),
    },
  ];
  const runs = [
    { run: "a confirmed prompt", agent: false, yes: false, answer: true, changed: true },
    { run: "a declined prompt", agent: false, yes: false, answer: false, changed: false },
    { run: "an agent run with --yes", agent: true, yes: true, answer: false, changed: true },
    { run: "an agent run without --yes", agent: true, yes: false, answer: false, changed: false },
  ];

  it.each(
    changes.flatMap((change) =>
      (["set", "unset"] as const).flatMap((action) =>
        runs.map((run) => ({ ...change, ...run, action })),
      ),
    ),
  )("$action $key on $run", async (scenario) => {
    const { key, saved, value, action, agent, yes, answer, changed } = scenario;
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    await saveWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));
    await saveConfigValue(key as ConfigKey, saved);
    const confirm = vi.fn(async () => answer);
    const context = runContext(agent);
    const result =
      action === "set"
        ? configSetHandler(key, value, { yes }, context, { confirm })
        : configUnsetHandler(key, { yes }, context, { confirm });
    const after = scenario[action];
    const warning = action === "set" ? scenario.warning : undefined;
    const argument = action === "set" ? ` ${scenario.shown ?? value}` : "";
    const placeholder = action === "set" ? scenario.placeholder : undefined;
    const ctaArgument = action === "set" ? ` ${placeholder ? `'${placeholder}'` : value}` : "";
    const command = `tempo wallet config ${action} ${key}${ctaArgument} --yes`;
    const verb = action === "set" ? "Save" : "Remove";

    if (agent && !yes) {
      const refusal = {
        code: "E_USAGE",
        exitCode: 2,
        retryable: false,
        message: [
          `${action === "set" ? "Saving" : "Removing"} ${key} changes what later commands use, so it needs confirmation: it goes from ${label(scenario.before)} to ${label(after)}.`,
          ...(warning ? [warning] : []),
          `Run '${command}' to confirm.`,
          ...(placeholder
            ? [
                `Replace ${placeholder} with the full ${key}, which is left out since it can carry a credential.`,
              ]
            : []),
        ].join(" "),
        cta: { commands: [{ command }] },
      };
      expect(await result).toEqual(refusal);
      expect(context.error).toHaveBeenCalledWith(refusal);
    } else if (changed) expect(await result).toEqual({ [key]: after });
    else
      await expect(result).rejects.toMatchObject({
        code: "E_USAGE",
        message: `${key} not ${action === "set" ? "saved" : "removed"}: not confirmed at the prompt`,
      });

    expect(confirm.mock.calls).toEqual(
      agent
        ? []
        : [
            [
              [
                `${verb} ${key}${argument}`,
                `  now:   ${label(scenario.before)}`,
                `  after: ${label(after)}`,
                ...(warning ? [warning] : []),
                `${verb} this setting?`,
              ].join("\n"),
            ],
          ],
    );
    expect(await savedConfig()).toEqual(
      !changed ? { [key]: saved } : action === "set" ? { [key]: value } : {},
    );
  });

  it.each([
    { action: "set", run: () => configSetHandler("max-spend", "5", {}, runContext()) },
    { action: "unset", run: () => configUnsetHandler("max-spend", {}, runContext()) },
  ])("needs no confirmation for a $action that changes nothing", async ({ action, run }) => {
    await useTempHome();
    if (action === "set") await saveConfigValue("max-spend", "5");

    expect(await run()).toMatchObject({
      "max-spend": { source: action === "set" ? "config" : "default" },
    });
  });

  it("notes when the variable that overrides a setting keeps it from changing", async () => {
    await useTempHome();
    vi.stubEnv("TEMPO_MAX_SPEND", "4");
    const context = runContext();

    expect(await configSetHandler("max-spend", "50", {}, context)).toMatchObject({
      message: expect.stringContaining("it goes from 4 (env) to 4 (env)"),
    });
    expect(await savedConfig()).toBeUndefined();
  });

  it.each([
    {
      url: "https://rpc.example.com/v2/apikey",
      command: "tempo wallet config set rpc-url '<rpc-url>' --yes",
      saves: false,
    },
    {
      url: "https://user:secret@rpc.example.com",
      command: "tempo wallet config set rpc-url '<rpc-url>' --yes",
      saves: false,
    },
    {
      url: "http://127.0.0.1:8545",
      command: "tempo wallet config set rpc-url http://127.0.0.1:8545 --yes",
      saves: true,
    },
  ])(
    "an rpc-url cta for $url saves the URL only when it can carry it whole",
    async ({ url, command, saves }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_RPC_URL", undefined);

      const refusal = await configSetHandler("rpc-url", url, {}, runContext());
      expect(refusal).toMatchObject({ cta: { commands: [{ command }] } });
      expect(JSON.stringify(refusal)).not.toContain("secret");
      expect(JSON.stringify(refusal)).not.toContain("apikey");

      // Run the cta as given: a placeholder fails validation, so nothing is saved.
      const [, , , action, key, argument] = command.split(" ");
      const run = confirmedSet(key!, argument!.replace(/^'(.*)'$/, "$1"));
      if (saves) {
        expect(action).toBe("set");
        await expect(run).resolves.toEqual({ "rpc-url": { value: url, source: "config" } });
        expect(await savedConfig()).toEqual({ "rpc-url": url });
      } else {
        await expect(run).rejects.toMatchObject({
          code: "E_USAGE",
          message: "rpc-url must be an http(s) URL",
        });
        expect(await savedConfig()).toBeUndefined();
      }
    },
  );

  it.each(configKeys.filter((key) => "redact" in configSettings[key]))(
    "the %s placeholder in a cta is not a valid setting",
    (key) => {
      expect(() => configSettings[key].parse(`<${key}>`)).toThrow();
    },
  );

  it("refuses a CLI change without --yes, with the confirmed command as its cta", async () => {
    await useTempHome();

    const error = await walletJson(["config", "set", "max-spend", "50"]).catch(
      (value: unknown) => value,
    );

    expect(error).toMatchObject({ code: 2 });
    expect(JSON.parse((error as { stdout: string }).stdout)).toMatchObject({
      code: "E_USAGE",
      cta: { commands: [{ command: "tempo wallet config set max-spend 50 --yes" }] },
    });
    expect(await savedConfig()).toBeUndefined();
  }, 30_000);
});

describe("a change made while another is confirmed", () => {
  const changes = [
    {
      name: "set over the value it found already saved",
      saved: "50",
      action: "set",
      yes: false,
      concurrent: "5",
    },
    {
      name: "unset finding nothing saved",
      saved: undefined,
      action: "unset",
      yes: false,
      concurrent: "5",
    },
    {
      name: "set confirmed at the prompt",
      saved: "5",
      action: "set",
      yes: false,
      prompt: true,
      concurrent: "7",
    },
    {
      name: "unset confirmed at the prompt",
      saved: "5",
      action: "unset",
      yes: false,
      prompt: true,
      concurrent: "7",
    },
  ] as const;

  it.each(changes)(
    "leaves the newer value for a $name",
    async ({ saved, action, yes, concurrent, ...change }) => {
      await useTempHome();
      if (saved) await saveConfigValue("max-spend", saved);
      // Another process saves `concurrent` just after this command reads the file.
      race.afterRead = () =>
        writeFileSync(configPath(), JSON.stringify({ "max-spend": concurrent }));
      const prompt = "prompt" in change;
      const context = runContext(!prompt);
      const confirm = vi.fn(async () => true);
      const run =
        action === "set"
          ? configSetHandler("max-spend", "50", { yes }, context, { confirm })
          : configUnsetHandler("max-spend", { yes }, context, { confirm });

      await expect(run).rejects.toMatchObject({
        code: "E_USAGE",
        retryable: true,
        message: `max-spend changed in ${configPath()} while this command ran, so nothing was changed. Rerun the command to review the new value.`,
      });
      expect(confirm).toHaveBeenCalledTimes(prompt ? 1 : 0);
      expect(await savedConfig()).toEqual({ "max-spend": concurrent });
    },
  );

  it("applies a --yes change over a newer value", async () => {
    await useTempHome();
    await saveConfigValue("max-spend", "5");
    race.afterRead = () => writeFileSync(configPath(), JSON.stringify({ "max-spend": "7" }));

    expect(await confirmedSet("max-spend", "50")).toEqual({
      "max-spend": { value: "50", source: "config" },
    });
    expect(await savedConfig()).toEqual({ "max-spend": "50" });
  });
});

describe("precedence", () => {
  const network = (value: string, source: ConfigSource) => ({ value, source });
  it.each<{
    key: ConfigKey;
    source: string;
    flag?: string;
    env?: string;
    saved?: string;
    chainId?: number;
    expected: { value: string; source: ConfigSource };
  }>([
    {
      key: "network",
      source: "--network over TEMPO_WALLET_NETWORK and the saved network",
      flag: "testnet",
      env: "mainnet",
      saved: "mainnet",
      expected: network("testnet", "flag"),
    },
    {
      key: "network",
      source: "--network over the saved network",
      flag: "tempo",
      saved: "testnet",
      chainId: 42431,
      expected: network("mainnet", "flag"),
    },
    {
      key: "network",
      source: "TEMPO_WALLET_NETWORK over the saved network",
      env: "testnet",
      saved: "mainnet",
      expected: network("testnet", "env"),
    },
    {
      key: "network",
      source: "the saved network over the logged-in chain",
      saved: "mainnet",
      chainId: 42431,
      expected: network("mainnet", "config"),
    },
    {
      key: "network",
      source: "the saved network over the default",
      saved: "testnet",
      expected: network("testnet", "config"),
    },
    {
      key: "network",
      source: "the logged-in chain over the default",
      chainId: 42431,
      expected: network("testnet", "login"),
    },
    {
      key: "network",
      source: "a mainnet login",
      chainId: 4217,
      expected: network("mainnet", "login"),
    },
    { key: "network", source: "the default", expected: network("mainnet", "default") },
    {
      key: "rpc-url",
      source: "TEMPO_RPC_URL over the saved rpc-url",
      env: "http://127.0.0.1:9",
      saved: "https://rpc.example.com",
      expected: { value: "http://127.0.0.1:9", source: "env" },
    },
    {
      key: "rpc-url",
      source: "the saved rpc-url over the default",
      saved: "https://rpc.example.com",
      expected: { value: "https://rpc.example.com", source: "config" },
    },
    {
      key: "rpc-url",
      source: "the default",
      expected: { value: mainnetRpc, source: "default" },
    },
    {
      key: "max-spend",
      source: "--max-spend over TEMPO_MAX_SPEND and the saved max-spend",
      flag: "3",
      env: "4",
      saved: "5",
      expected: { value: "3", source: "flag" },
    },
    {
      key: "max-spend",
      source: "--max-spend over the saved max-spend",
      flag: "0",
      saved: "5",
      expected: { value: "0", source: "flag" },
    },
    {
      key: "max-spend",
      source: "TEMPO_MAX_SPEND over the saved max-spend",
      env: "4",
      saved: "5",
      expected: { value: "4", source: "env" },
    },
    {
      key: "max-spend",
      source: "the saved max-spend over an empty TEMPO_MAX_SPEND",
      env: " ",
      saved: "5",
      expected: { value: "5", source: "config" },
    },
    {
      key: "max-spend",
      source: "the saved max-spend over the default",
      saved: "5",
      expected: { value: "5", source: "config" },
    },
    { key: "max-spend", source: "the default", expected: { value: "10", source: "default" } },
  ])("$key comes from $source", async ({ key, flag, env, saved, chainId, expected }) => {
    await useTempHome();
    vi.stubEnv(configSettings[key].env, env);
    if (key !== "rpc-url") vi.stubEnv("TEMPO_RPC_URL", undefined);
    if (chainId) await saveWalletState(walletState({ chainId }));
    if (saved) await saveConfigValue(key, saved);

    if (key === "network") {
      const { network, source } = await networkSetting(flag);
      expect({ value: network.name, source }).toEqual(expected);
      expect(await resolveNetwork(flag)).toEqual(network);
      expect(await configGetHandler(key, { network: flag })).toEqual({ [key]: expected });
    }
    if (key === "rpc-url") {
      expect({ value: rpcUrl(4217), source: rpcUrlOverride()?.source ?? "default" }).toEqual(
        expected,
      );
      expect(await configGetHandler(key)).toEqual({ [key]: expected });
    }
    if (key === "max-spend") {
      expect(maxSpendSetting(flag)).toEqual(expected);
      expect(resolveMaxSpend(flag)).toBe(
        expected.source === "default" ? undefined : expected.value,
      );
      if (flag === undefined) expect(await configGetHandler(key)).toEqual({ [key]: expected });
    }
  });

  it.each([
    { source: "TEMPO_RPC_URL", env: "http://127.0.0.1:9", saved: undefined },
    { source: "a saved rpc-url", env: undefined, saved: "https://rpc.example.com" },
  ])("$source serves every network", async ({ env, saved }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", env);
    if (saved) await saveConfigValue("rpc-url", saved);

    expect(rpcUrl(4217)).toBe(env ?? saved);
    expect(rpcUrl(42431)).toBe(env ?? saved);
  });

  it("uses each network's default RPC without an override", async () => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);

    expect(rpcUrl(4217)).toBe(mainnetRpc);
    expect(rpcUrl(42431)).toBe(moderatoRpc);
  });

  it("checks that a saved rpc-url is on a chain before trusting its reads there", async () => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    const rpc = await chainRpc(42431);
    try {
      expect(await rpcChainCheck()(42431)).toBe(true);
      expect(rpc.requests).toEqual([]);

      await saveConfigValue("rpc-url", rpc.url);
      const servesChain = rpcChainCheck();

      expect(await servesChain(42431)).toBe(true);
      expect(await servesChain(4217)).toBe(false);
      expect(rpc.requests).toEqual(["eth_chainId", "eth_chainId"]);
    } finally {
      await rpc.close();
    }
  });

  // One saved endpoint serves both networks' reads, so each balance counts only on the chain the
  // endpoint reports; the other network's balance is unknown, never this chain's.
  it.each([
    {
      command: "keys list",
      read: async () =>
        (await keysHandler({})).keys.map(({ chain_id, balance }) => ({ chain_id, balance })),
      expected: [
        { chain_id: 4217, balance: null },
        { chain_id: 42431, balance: "7" },
      ],
    },
    {
      command: "whoami on mainnet",
      read: async () => {
        const { balance, ready } = (await whoamiHandler({ network: "mainnet" })) as {
          balance: { available: string | null };
          ready: boolean;
        };
        return { available: balance.available, ready };
      },
      expected: { available: null, ready: false },
    },
    {
      command: "whoami on testnet",
      read: async () => {
        const { balance } = (await whoamiHandler({ network: "testnet" })) as {
          balance: { available: string | null };
        };
        return { available: balance.available };
      },
      expected: { available: "7" },
    },
    {
      command: "balance on mainnet",
      read: () =>
        readyWallet("mainnet", false)
          .then((wallet) => balanceHandler(wallet, {}))
          .catch((error: { code: string }) => error.code),
      expected: "E_NETWORK",
    },
    {
      command: "balance on testnet",
      read: async () =>
        (await balanceHandler(await readyWallet("testnet", false), {})).balances.map(
          ({ balance }) => balance,
        ),
      expected: ["7"],
    },
  ])(
    "$command reads no balance through a saved rpc-url on another chain",
    async ({ read, expected }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_RPC_URL", undefined);
      await saveWalletState(
        walletState({ accessKeys: [walletState().accessKeys[0]!, testnetKey] }),
      );
      const rpc = await chainRpc(42431);
      try {
        await saveConfigValue("rpc-url", rpc.url);

        expect(await read()).toEqual(expected);
        expect(rpc.requests).toContain("eth_chainId");
      } finally {
        await rpc.close();
      }
    },
  );

  it("tempo request pays on the saved network and caps spending at the saved max-spend", async () => {
    await useTempHome();
    await saveWalletState(walletState({ chainId: 4217 }));
    await saveConfigValue("network", "testnet");
    await saveConfigValue("max-spend", "5");

    const options = parseRequestArgs(["https://example.com/paid"]);

    expect(options.maxSpend).toBe("5");
    expect(await resolvePaymentNetwork(options)).toEqual({ name: "testnet", chainId: 42431 });
    expect(parseRequestArgs(["--max-spend", "2", "https://example.com/paid"]).maxSpend).toBe("2");
    // A private-key payer ignores the logged-in chain, but not the saved network.
    vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey);
    expect(await resolvePaymentNetwork(parseRequestArgs(["https://example.com/paid"]))).toEqual({
      name: "testnet",
      chainId: 42431,
    });
  });
});

describe("the saved network and the logged-in chain", () => {
  it("whoami follows the saved network over a testnet login until --network or unset", async () => {
    await useTempHome();
    await saveWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));
    await saveConfigValue("network", "mainnet");

    expect(await walletJson(["whoami"])).toMatchObject({ chain_id: 4217, network: "tempo" });
    expect(await walletJson(["whoami", "-n", "testnet"])).toMatchObject({
      chain_id: 42431,
      network: "tempo-moderato",
    });
    expect(await walletJson(["config", "get", "network"])).toEqual({
      network: { value: "mainnet", source: "config" },
    });

    expect(await walletJson(["config", "unset", "network", "--yes"])).toEqual({
      network: { value: "testnet", source: "login" },
    });
    expect(await walletJson(["whoami"])).toMatchObject({
      chain_id: 42431,
      network: "tempo-moderato",
    });
  }, 30_000);

  it("leaves keys list and logout covering every network", async () => {
    await useTempHome();
    await saveWalletState(walletState({ accessKeys: [walletState().accessKeys[0]!, testnetKey] }));
    await saveConfigValue("network", "testnet");

    expect(explicitNetwork(undefined)).toBeUndefined();
    expect((await keysHandler({})).keys.map((key) => key.chain_id)).toEqual([4217, 42431]);
    expect((await keysHandler({ network: "testnet" })).keys.map((key) => key.chain_id)).toEqual([
      42431,
    ]);
    expect(await logoutHandler({}, runContext())).toMatchObject({ scope: "all" });
    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
  });
});

describe("one command's settings", () => {
  const readers: Record<ConfigKey, { read: () => unknown; first: string; next: string }> = {
    network: {
      read: async () => (await resolveNetwork(undefined)).name,
      first: "testnet",
      next: "mainnet",
    },
    "rpc-url": {
      read: () => rpcUrl(4217),
      first: "https://first.example.com",
      next: "https://next.example.com",
    },
    "max-spend": { read: () => resolveMaxSpend(), first: "5", next: "50" },
  };

  it.each(configKeys)("keep the first %s a command reads", async (key) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    const { read, first, next } = readers[key];
    await saveConfigValue(key, first);

    await withConfigSnapshot(async () => {
      expect(await read()).toBe(first);
      // Another process saves a new value while this command runs.
      writeFileSync(configPath(), JSON.stringify({ [key]: next }));
      expect(await read()).toBe(first);
    });
    // The next command reads it.
    expect(await read()).toBe(next);
  });

  it("checks and reads keys list balances through one rpc-url while another process changes it", async () => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    await saveWalletState(walletState());
    const next = await chainRpc(42431);
    // Once its chain is checked, another process points the saved rpc-url at the other chain.
    const first = await chainRpc(4217, {
      onChainId: () => writeFileSync(configPath(), JSON.stringify({ "rpc-url": next.url })),
    });
    try {
      await saveConfigValue("rpc-url", first.url);

      const output = (await walletJson(["keys", "list"])) as { keys: { balance: string | null }[] };

      expect(output.keys.map(({ balance }) => balance)).toEqual(["7"]);
      expect(first.requests).toContain("eth_chainId");
      expect(next.requests).toEqual([]);
      // The change applies to the next command, which finds that endpoint on another chain.
      const after = (await walletJson(["keys", "list"])) as { keys: { balance: string | null }[] };
      expect(after.keys.map(({ balance }) => balance)).toEqual([null]);
      expect(next.requests).toContain("eth_chainId");
    } finally {
      await Promise.all([first.close(), next.close()]);
    }
  }, 30_000);
});

describe("an invalid config file", () => {
  const fix = "Fix it, or delete it to clear every setting.";
  const unset = (key: string) => `Run 'tempo wallet config unset ${key}', or fix the file.`;
  const readers: Record<ConfigKey, () => unknown> = {
    network: () => resolveNetwork(undefined),
    "rpc-url": () => rpcUrl(4217),
    "max-spend": () => resolveMaxSpend(),
  };

  it.each<{ name: string; body: string; keys: readonly ConfigKey[]; problem: string }>([
    {
      name: "is not JSON",
      body: "{",
      keys: ["network", "rpc-url", "max-spend"],
      problem: `is not valid JSON. ${fix}`,
    },
    {
      name: "is an array",
      body: "[]",
      keys: ["network", "rpc-url", "max-spend"],
      problem: `is not a JSON object. ${fix}`,
    },
    {
      name: "is null",
      body: "null",
      keys: ["network", "rpc-url", "max-spend"],
      problem: `is not a JSON object. ${fix}`,
    },
    {
      name: "holds an unsupported network",
      body: '{"network":"typo","max-spend":"5"}',
      keys: ["network"],
      problem: `has an invalid network (Unsupported network: typo). ${unset("network")}`,
    },
    {
      name: "holds a network alias in another case",
      body: '{"network":"TESTNET"}',
      keys: ["network"],
      problem: `has an invalid network (Unsupported network: TESTNET). ${unset("network")}`,
    },
    {
      name: "holds a non-http rpc-url",
      body: '{"rpc-url":"ftp://rpc.example.com"}',
      keys: ["rpc-url"],
      problem: `has an invalid rpc-url (rpc-url must be an http(s) URL). ${unset("rpc-url")}`,
    },
    {
      name: "holds a zero max-spend",
      body: '{"max-spend":"0"}',
      keys: ["max-spend"],
      problem: `has an invalid max-spend (max-spend must be a positive amount with at most 6 decimal places). ${unset("max-spend")}`,
    },
    {
      name: "holds a number for max-spend",
      body: '{"max-spend":5}',
      keys: ["max-spend"],
      problem: `has an invalid max-spend (expected a string). ${unset("max-spend")}`,
    },
  ])("that $name fails each reader of it, naming the file", async ({ body, keys, problem }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", undefined);
    await writeConfig(body);
    const error = {
      code: "E_USAGE",
      exitCode: 2,
      path: configPath(),
      message: `Config file ${configPath()} ${problem}`,
    };

    await expect(configGetHandler(undefined)).rejects.toMatchObject(error);
    for (const key of Object.keys(readers) as ConfigKey[]) {
      const read = async () => readers[key]();
      if (keys.includes(key)) {
        await expect(read()).rejects.toMatchObject(error);
        await expect(configGetHandler(key)).rejects.toMatchObject(error);
      } else await expect(read()).resolves.not.toThrow();
    }
  });

  it("is not read for a setting its flag or environment variable overrides", async () => {
    await useTempHome();
    await writeConfig("{");
    vi.stubEnv("TEMPO_RPC_URL", "http://127.0.0.1:9");

    expect((await resolveNetwork("testnet")).name).toBe("testnet");
    expect(resolveMaxSpend("3")).toBe("3");
    expect(rpcUrl(4217)).toBe("http://127.0.0.1:9");
  });

  it("fails a command with E_USAGE naming the file", async () => {
    await useTempHome();
    await writeConfig("{");

    const error = await walletJson(["whoami"]).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: 2 });
    expect(JSON.parse((error as { stdout: string }).stdout)).toMatchObject({
      code: "E_USAGE",
      message: `Config file ${configPath()} is not valid JSON. ${fix}`,
    });
  }, 30_000);

  it("can still have the invalid setting unset or replaced, keeping the others", async () => {
    await useTempHome();
    await writeConfig('{"network":"typo","future-setting":["kept"],"max-spend":"0"}');

    expect(await confirmedUnset("network")).toEqual({
      network: { value: "mainnet", source: "default" },
    });
    expect(await confirmedSet("max-spend", "5")).toEqual({
      "max-spend": { value: "5", source: "config" },
    });
    expect(await savedConfig()).toEqual({ "future-setting": ["kept"], "max-spend": "5" });
  });

  it("is left in place when it is not a JSON object", async () => {
    await useTempHome();
    await writeConfig("{");

    await expect(confirmedSet("network", "testnet")).rejects.toMatchObject({
      code: "E_USAGE",
      message: `Config file ${configPath()} is not valid JSON. ${fix}`,
    });
    await expect(confirmedUnset("network")).rejects.toMatchObject({ code: "E_USAGE" });
    expect(await readFile(configPath(), "utf8")).toBe("{");
  });
});

describe("the config file", () => {
  it.skipIf(process.platform === "win32")(
    "is written atomically, readable only by its owner",
    async () => {
      const home = await useTempHome();
      await chmod(join(home, ".tempo"), 0o755);
      await writeConfig("{}");
      await chmod(configPath(), 0o644);

      await confirmedSet("network", "testnet");

      expect((await stat(configPath())).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(configPath()))).mode & 0o777).toBe(0o700);
      expect((await stat(join(home, ".tempo"))).mode & 0o777).toBe(0o700);
      // Only the config file and its lock remain; no temporary file is left behind.
      expect(
        (await readdir(dirname(configPath()))).filter((name) => name.startsWith(".config")),
      ).toEqual([]);
    },
  );

  it("keeps every setting from concurrent changes", async () => {
    await useTempHome();

    await Promise.all([
      confirmedSet("network", "testnet"),
      confirmedSet("rpc-url", "https://rpc.example.com"),
      confirmedSet("max-spend", "5"),
    ]);
    expect(await savedConfig()).toEqual({
      network: "testnet",
      "rpc-url": "https://rpc.example.com",
      "max-spend": "5",
    });

    await Promise.all([confirmedUnset("network"), confirmedUnset("max-spend")]);
    expect(await savedConfig()).toEqual({ "rpc-url": "https://rpc.example.com" });
  });

  it("keeps every setting from concurrent processes", async () => {
    await useTempHome();

    await Promise.all([
      walletJson(["config", "set", "network", "testnet", "--yes"]),
      walletJson(["config", "set", "rpc-url", "https://rpc.example.com", "--yes"]),
      walletJson(["config", "set", "max-spend", "5", "--yes"]),
    ]);

    expect(await savedConfig()).toEqual({
      network: "testnet",
      "rpc-url": "https://rpc.example.com",
      "max-spend": "5",
    });
  }, 30_000);
});

describe("MCP tools", () => {
  it("annotates the config tools", async () => {
    await useTempHome();

    const [list] = await mcpSession([{ method: "tools/list", params: {} }]);
    const tools = (list as { result: { tools: { name: string; annotations?: unknown }[] } }).result
      .tools;

    expect(
      Object.fromEntries(
        tools
          .filter((tool) => tool.name.startsWith("config_"))
          .map((tool) => [tool.name, tool.annotations]),
      ),
    ).toEqual({
      config_get: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      config_set: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      config_unset: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
  }, 30_000);

  it("sets, gets, and unsets a setting from one server", async () => {
    await useTempHome();
    const call = (name: string, args: Record<string, unknown>) => ({
      method: "tools/call",
      params: { name, arguments: args },
    });

    const responses = await mcpSession([
      call("config_set", { key: "max-spend", value: "5", yes: true }),
      call("config_get", {}),
      call("config_set", { key: "max-spend", value: "50" }),
      call("config_unset", { key: "max-spend" }),
      call("config_unset", { key: "max-spend", yes: true }),
      call("config_get", { key: "max-spend" }),
      call("config_set", { key: "max_spend", value: "5", yes: true }),
    ]);
    const results = responses.map(
      (response) =>
        (
          response as {
            result: {
              isError?: boolean;
              structuredContent?: unknown;
              content: { text: string }[];
              _meta?: unknown;
            };
          }
        ).result,
    );
    const refused = (command: string) => ({
      isError: true,
      _meta: { cta: { commands: [{ command }] } },
    });

    expect(results[0]).toMatchObject({
      structuredContent: { "max-spend": { value: "5", source: "config" } },
    });
    expect(results[1]).toMatchObject({
      structuredContent: {
        network: { source: "default" },
        "max-spend": { value: "5", source: "config" },
      },
    });
    // Without `yes`, an agent's change is refused, naming the command that confirms it.
    expect(results[2]).toMatchObject(refused("tempo wallet config set max-spend 50 --yes"));
    expect(results[3]).toMatchObject(refused("tempo wallet config unset max-spend --yes"));
    expect(results[4]).toMatchObject({
      structuredContent: { "max-spend": { value: "10", source: "default" } },
    });
    expect(results[5]).toMatchObject({
      structuredContent: { "max-spend": { value: "10", source: "default" } },
    });
    expect(results[6]).toMatchObject({ isError: true });
    expect(results[6]!.content[0]!.text).toContain(
      "Unknown config key: max_spend. Valid keys: network, rpc-url, max-spend",
    );
    expect(await savedConfig()).toEqual({});
  }, 30_000);
});

async function walletJson(args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliBundle("wallet"), ...args, "--format", "json"],
    { env: { ...process.env } },
  );
  return JSON.parse(stdout) as unknown;
}

/**
 * A JSON-RPC endpoint on `chainId` that records each method it is asked. It answers `balanceOf`
 * with 7 tokens and fails any other call, as for an access key the chain does not hold.
 */
async function chainRpc(chainId: number, { onChainId }: { onChainId?: () => void } = {}) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body) as {
        id: number;
        method: string;
        params?: [{ data?: string }?];
      };
      requests.push(method);
      if (method === "eth_chainId") onChainId?.();
      response.setHeader("content-type", "application/json");
      const balanceOf = method === "eth_call" && params?.[0]?.data?.startsWith("0x70a08231");
      response.end(
        JSON.stringify(
          method === "eth_chainId"
            ? { jsonrpc: "2.0", id, result: `0x${chainId.toString(16)}` }
            : balanceOf
              ? { jsonrpc: "2.0", id, result: `0x${7_000_000n.toString(16).padStart(64, "0")}` }
              : { jsonrpc: "2.0", id, error: { code: -32000, message: "execution reverted" } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Sends each request to one `tempo wallet --mcp` process once the last is answered. */
async function mcpSession(requests: { method: string; params: Record<string, unknown> }[]) {
  const child = spawn(process.execPath, [cliBundle("wallet"), "--mcp"], {
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const answers = new Map<number, (message: unknown) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { id?: number };
    if (message.id !== undefined) answers.get(message.id)?.(message);
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise<never>((_, reject) =>
    child.once("exit", (code) => reject(new Error(stderr || `MCP process exited with ${code}`))),
  );
  const send = (id: number, method: string, params: Record<string, unknown>) =>
    Promise.race([
      new Promise<unknown>((resolve) => {
        answers.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      }),
      exited,
    ]);
  try {
    await send(0, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    const responses: unknown[] = [];
    for (const [index, { method, params }] of requests.entries())
      responses.push(await send(index + 1, method, params));
    return responses;
  } finally {
    exited.catch(() => undefined);
    child.stdin.end();
    child.kill();
  }
}
