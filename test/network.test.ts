import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { explicitNetwork, parseNetwork, resolveNetwork } from "../src/shared/network.js";
import { saveWalletState, type WalletState } from "../src/wallet/store.js";
import { useTempHome, walletState } from "./helpers.js";

const mainnet = { name: "mainnet", chainId: 4217 };
const testnet = { name: "testnet", chainId: 42431 };

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  ["mainnet", mainnet],
  ["tempo", mainnet],
  ["testnet", testnet],
  ["tempo-moderato", testnet],
  ["moderato", testnet],
])("parses %s", (value, network) => {
  expect(parseNetwork(value)).toEqual(network);
});

it.each([
  { source: "--network", flag: "typo", env: undefined },
  { source: "TEMPO_WALLET_NETWORK", flag: undefined, env: "typo" },
])("rejects an unknown network from $source", async ({ flag, env }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);

  await expect(resolveNetwork(flag)).rejects.toMatchObject({
    code: "E_USAGE",
    exitCode: 2,
    message: "Unsupported network: typo",
  });
});

it.each<{
  name: string;
  flag?: string;
  env?: string;
  state?: WalletState;
  expected: typeof mainnet;
}>([
  { name: "defaults to mainnet", expected: mainnet },
  { name: "uses the logged-in chain", state: walletState({ chainId: 42431 }), expected: testnet },
  {
    name: "prefers TEMPO_WALLET_NETWORK over the logged-in chain",
    env: "mainnet",
    state: walletState({ chainId: 42431 }),
    expected: mainnet,
  },
  {
    name: "prefers --network over TEMPO_WALLET_NETWORK",
    flag: "tempo-moderato",
    env: "mainnet",
    state: walletState(),
    expected: testnet,
  },
  {
    name: "ignores the stored chain when logged out",
    state: { accounts: [], accessKeys: [], chainId: 42431 },
    expected: mainnet,
  },
])("resolveNetwork $name", async ({ flag, env, state, expected }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);
  if (state) await saveWalletState(state);

  expect(await resolveNetwork(flag)).toEqual(expected);
});

it.each([
  { flag: undefined, env: undefined, expected: undefined },
  { flag: undefined, env: "testnet", expected: testnet },
  { flag: "mainnet", env: "testnet", expected: mainnet },
])("explicitNetwork($flag) with TEMPO_WALLET_NETWORK=$env", ({ flag, env, expected }) => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);

  expect(explicitNetwork(flag)).toEqual(expected);
});
