import { createPublicClient, http, type Address, type HttpTransportConfig } from "viem";
import { Chain } from "viem/tempo";

import { CtaError } from "../cli/incur-compat.js";
import {
  commandCached,
  configValue,
  networkConfigValue,
  type Config,
  type ConfigSource,
} from "../wallet/config.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import { commandError, usageError, walletError } from "./errors.js";

import { mainnetEscrow, moderatoEscrow, moderatoToken, usdcToken } from "./constants.js";

export type Network = { name: "mainnet" | "testnet"; chainId: number };

const mainnet: Network = { name: "mainnet", chainId: 4217 };
const testnet: Network = { name: "testnet", chainId: 42431 };

/** Every network the CLI supports. */
export const networks: readonly Network[] = [mainnet, testnet];

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
 * `resolveNetwork`'s network and where it came from, reading the saved `network` from `config`
 * (by default, the config file). A saved `network` beats the logged-in chain, which is only where
 * the last login or refresh switched the wallet, so commands never leave a network the user chose.
 */
export async function networkSetting(
  flag: string | undefined,
  state?: WalletState,
  config?: Config,
): Promise<{ network: Network; source: ConfigSource }> {
  if (flag !== undefined) return { network: parseNetwork(flag), source: "flag" };
  const env = process.env.TEMPO_WALLET_NETWORK;
  if (env !== undefined) return { network: parseNetwork(env), source: "env" };
  const saved = configValue("network", parseNetwork, config);
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

export function rpcUrl(chain: number, config?: Config) {
  const override = rpcUrlOverride(chain, config);
  if (override) return override.value;
  if (chain === 42431) return "https://rpc.moderato.tempo.xyz";
  return "https://rpc.mainnet.tempo.xyz";
}

/**
 * The endpoint that replaces `chain`'s default RPC: `TEMPO_RPC_URL`, which serves every network,
 * then the `rpc-url` saved in `config` (by default, the config file) for `chain`'s network alone.
 * The saved one was on that chain when it was set, but either can be on another chain now, so
 * reads that a refusal or deletion rests on check the chain first; see `requireRpcChain`.
 */
export function rpcUrlOverride(
  chain: number,
  config?: Config,
): { value: string; source: "env" | "config" } | undefined {
  if (process.env.TEMPO_RPC_URL) return { value: process.env.TEMPO_RPC_URL, source: "env" };
  const network = networks.find((candidate) => candidate.chainId === chain);
  const saved = network && networkConfigValue("rpc-url", network.name, parseRpcUrl, config);
  return saved === undefined ? undefined : { value: saved, source: "config" };
}

/**
 * Checks an `rpc-url` setting: an http(s) URL that requests can be sent to. Credentials go in a
 * Basic `Authorization` header only with a username, and fetch refuses a URL that still carries
 * any, so a password without a username is refused here rather than failing every RPC call.
 */
export function parseRpcUrl(value: string) {
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol))
    throw usageError("rpc-url must be an http(s) URL");
  const url = new URL(value);
  if (url.password && !url.username)
    throw usageError(
      "rpc-url has a password but no username; RPC requests send credentials only as user:password@, so add the username",
    );
  // As viem sends it: credentials move to a header, and fetch must accept what remains.
  url.username = "";
  url.password = "";
  try {
    new Request(url);
  } catch {
    throw usageError("rpc-url is not a URL an RPC request can be sent to");
  }
  return value;
}

/** The chain `url` answers `eth_chainId` with, bounded and without retries; `null` when it fails. */
export async function rpcEndpointChain(url: string) {
  return await createPublicClient({ transport: http(url, rpcCheckOptions) })
    .getChainId()
    .catch(() => null);
}

const rpcCheckOptions = { timeout: 3_000, retryCount: 0 };

/**
 * Refuses an RPC override on another chain than `chain` before a read whose answer can delete or
 * rewrite a stored session or key, or decide whether to revoke one: an endpoint on another chain
 * reads a funded channel as missing and a published key as absent. The endpoint's `eth_chainId`
 * is asked once per command (see `commandCached`), bounded and without retries; the per-network
 * default URLs need no check. The refusal is `E_USAGE`, retryable only when the endpoint did not
 * answer, with `tempo wallet config get rpc-url` as its `cta`.
 */
export async function requireRpcChain(chain: number) {
  const override = rpcUrlOverride(chain);
  if (!override) return;
  const served = await commandCached(`rpc chain ${chain} ${override.value}`, () =>
    createTempoPublicClient(chain, rpcCheckOptions)
      .getChainId()
      .catch(() => null),
  );
  if (served === chain) return;
  const endpoint =
    override.source === "env" ? "TEMPO_RPC_URL" : `The saved rpc-url for ${networkName(chain)}`;
  const answer =
    served === null
      ? "did not answer eth_chainId"
      : `is on ${networkName(served)} (chain ${served}), not ${networkName(chain)} (chain ${chain})`;
  const command = "tempo wallet config get rpc-url";
  throw new CtaError(
    commandError(
      "E_USAGE",
      `${endpoint} ${answer}, so nothing was read, changed, or revoked. Check the endpoint with '${command}'.`,
      command,
      { retryable: served === null },
    ),
  );
}

/**
 * Checks that `url` answers `eth_chainId` with `network`'s chain before it is saved as its
 * `rpc-url`; an endpoint that cannot be reached is refused too, since it cannot be shown to serve
 * the network. Returns the verified chain.
 */
export async function verifyRpcUrl(url: string, network: Network) {
  const served = await rpcEndpointChain(url);
  if (served === network.chainId) return served;
  if (served === null)
    throw walletError({
      code: "E_USAGE",
      message: `rpc-url did not answer eth_chainId within ${rpcCheckOptions.timeout / 1000} seconds, so it was not saved for ${network.name}. Check that it is reachable, then retry.`,
      retryable: true,
    });
  const other = networks.find((candidate) => candidate.chainId === served);
  throw usageError(
    `rpc-url is on ${networkName(served)} (chain ${served}), not ${network.name} (chain ${network.chainId}), so it was not saved.${other ? ` Pass --network ${other.name} to save it for ${other.name}.` : ""}`,
  );
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
