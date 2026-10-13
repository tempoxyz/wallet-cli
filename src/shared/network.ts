import { machineTokenDeployments } from "mppx/tempo";
import { createPublicClient, http, type Address, type HttpTransportConfig } from "viem";
import { Chain } from "viem/tempo";

import { loadWalletState, type WalletState } from "../wallet/store.js";
import { usageError } from "./errors.js";

import { mainnetEscrow, moderatoEscrow, moderatoToken, usdcToken } from "./constants.js";

export type Network = { name: "mainnet" | "testnet"; chainId: number };

const mainnet: Network = { name: "mainnet", chainId: 4217 };
const testnet: Network = { name: "testnet", chainId: 42431 };

/**
 * Selects the network for a command: the `--network` flag, then `TEMPO_WALLET_NETWORK`,
 * then the logged-in wallet's chain, then mainnet. Resolve once per command, passing the
 * wallet `state` the command already loaded so both read the same snapshot.
 */
export async function resolveNetwork(
  flag: string | undefined,
  state?: WalletState,
): Promise<Network> {
  const explicit = explicitNetwork(flag);
  if (explicit) return explicit;
  const wallet = state ?? (await loadWalletState());
  const loggedIn = wallet.accounts[wallet.activeAccount ?? 0] !== undefined;
  return loggedIn && storedChainId(wallet) === testnet.chainId ? testnet : mainnet;
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
  if (process.env.TEMPO_RPC_URL) return process.env.TEMPO_RPC_URL;
  if (chain === 42431) return "https://rpc.moderato.tempo.xyz";
  return "https://rpc.mainnet.tempo.xyz";
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

export function tokenSymbol(token: string) {
  if (
    Object.values(machineTokenDeployments).some(
      (deployment) => token.toLowerCase() === deployment.token.toLowerCase(),
    )
  )
    return "MACH";
  if (token.toLowerCase() === usdcToken) return "USDC.e";
  if (token.toLowerCase() === moderatoToken) return "PathUSD";
  return token;
}

export const appUrl = process.env.TEMPO_AUTH_URL ?? "https://wallet.tempo.xyz";
