import { createPublicClient, http, type Address, type HttpTransportConfig } from "viem";
import { Chain } from "viem/tempo";

import { configValue, type ConfigSource } from "../wallet/config.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import { usageError } from "./errors.js";

import { mainnetEscrow, moderatoEscrow, moderatoToken, usdcToken } from "./constants.js";

export type Network = { name: "mainnet" | "testnet"; chainId: number };

const mainnet: Network = { name: "mainnet", chainId: 4217 };
const testnet: Network = { name: "testnet", chainId: 42431 };

/**
 * Selects the network for a command: the `--network` flag, then `TEMPO_WALLET_NETWORK`,
 * then the config file's `network`, then the logged-in wallet's chain, then mainnet. Resolve
 * once per command, passing the wallet `state` the command already loaded so both read the
 * same snapshot.
 */
export async function resolveNetwork(
  flag: string | undefined,
  state?: WalletState,
): Promise<Network> {
  return (await networkSetting(flag, state)).network;
}

/**
 * `resolveNetwork`'s network and where it came from. A saved `network` beats the logged-in
 * chain, which is only where the last login or refresh switched the wallet, so commands never
 * leave a network the user chose.
 */
export async function networkSetting(
  flag: string | undefined,
  state?: WalletState,
): Promise<{ network: Network; source: ConfigSource }> {
  if (flag !== undefined) return { network: parseNetwork(flag), source: "flag" };
  const env = process.env.TEMPO_WALLET_NETWORK;
  if (env !== undefined) return { network: parseNetwork(env), source: "env" };
  const saved = configValue("network", parseNetwork);
  if (saved) return { network: saved, source: "config" };
  const wallet = state ?? (await loadWalletState());
  const loggedIn = wallet.accounts[wallet.activeAccount ?? 0] !== undefined;
  return { network: walletNetwork(wallet), source: loggedIn ? "login" : "default" };
}

/** The logged-in wallet's network, or mainnet when no wallet is logged in. */
export function walletNetwork(state: WalletState): Network {
  const loggedIn = state.accounts[state.activeAccount ?? 0] !== undefined;
  return loggedIn && storedChainId(state) === testnet.chainId ? testnet : mainnet;
}

/** The wallet store's chain; a store without one is on mainnet, the default it is saved with. */
export function storedChainId(state: WalletState) {
  return state.chainId ?? mainnet.chainId;
}

/** The network named by the `--network` flag or `TEMPO_WALLET_NETWORK`, if either is set. */
export function explicitNetwork(flag: string | undefined) {
  const value = flag ?? process.env.TEMPO_WALLET_NETWORK;
  return value === undefined ? undefined : parseNetwork(value);
}

export function parseNetwork(value: string) {
  if (value === "testnet" || value === "tempo-moderato" || value === "moderato") return testnet;
  if (value === "mainnet" || value === "tempo") return mainnet;
  throw usageError(`Unsupported network: ${value}`);
}

export function networkName(chain: number) {
  if (chain === 4217) return "tempo";
  if (chain === 42431) return "tempo-moderato";
  return `chain-${chain}`;
}

/** Identifies the network a command ran against in its output. */
export function networkFields(chain: number) {
  return { chain_id: chain, network: networkName(chain) };
}

export function rpcUrl(chain: number) {
  const override = rpcUrlOverride();
  if (override) return override.value;
  if (chain === 42431) return "https://rpc.moderato.tempo.xyz";
  return "https://rpc.mainnet.tempo.xyz";
}

/**
 * The one endpoint that replaces every network's default RPC: `TEMPO_RPC_URL`, then the config
 * file's `rpc-url`. It serves whichever chain it is on, so reads that must reach a given network
 * check its chain first; see `rpcChainCheck`.
 */
export function rpcUrlOverride(): { value: string; source: "env" | "config" } | undefined {
  if (process.env.TEMPO_RPC_URL) return { value: process.env.TEMPO_RPC_URL, source: "env" };
  const saved = configValue("rpc-url", parseRpcUrl);
  return saved === undefined ? undefined : { value: saved, source: "config" };
}

/** Checks an `rpc-url` setting: an http(s) URL. */
export function parseRpcUrl(value: string) {
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol))
    throw usageError("rpc-url must be an http(s) URL");
  return value;
}

export function escrowContract(chain: number) {
  return (chain === 42431 ? moderatoEscrow : mainnetEscrow) as Address;
}

export function tokenAddress(chain: number) {
  return (chain === 42431 ? moderatoToken : usdcToken) as Address;
}

export function createTempoPublicClient(
  chain: number,
  options: Pick<HttpTransportConfig, "timeout" | "retryCount"> = {},
) {
  return createPublicClient({
    chain: chain === 42431 ? Chain.tempoModerato : Chain.tempo,
    transport: http(rpcUrl(chain), options),
  });
}

export function tokenDecimals() {
  return 6;
}

export const appUrl = process.env.TEMPO_AUTH_URL ?? "https://wallet.tempo.xyz";
