import { machineTokenDeployments } from "mppx/tempo";
import { createPublicClient, http, type Address, type HttpTransportConfig } from "viem";
import { Chain } from "viem/tempo";
import { tokens } from "viem/tokens";

import { usageError } from "./errors.js";

import { mainnetEscrow, moderatoEscrow, moderatoToken, usdcToken } from "./constants.js";

export function chainId(network: string | undefined) {
  return isTestnet(network) ? 42431 : 4217;
}

export function isTestnet(network: string | undefined) {
  return normalizeNetwork(network ?? process.env.TEMPO_WALLET_NETWORK ?? "mainnet") === "testnet";
}

export function networkName(chain: number | null) {
  if (chain === 4217) return "tempo";
  if (chain === 42431) return "tempo-moderato";
  if (chain === null) return null;
  return `chain-${chain}`;
}

export function rpcUrl(network: string | undefined) {
  if (process.env.TEMPO_RPC_URL) return process.env.TEMPO_RPC_URL;
  if (chainId(network) === 42431) return "https://rpc.moderato.tempo.xyz";
  return "https://rpc.mainnet.tempo.xyz";
}

export function escrowContract(chain: number) {
  return (chain === 42431 ? moderatoEscrow : mainnetEscrow) as Address;
}

export function tokenAddress(chain: number) {
  return (chain === 42431 ? moderatoToken : usdcToken) as Address;
}

export function createTempoPublicClient(
  network: string | undefined,
  options: Pick<HttpTransportConfig, "timeout" | "retryCount"> = {},
) {
  const chain = chainId(network) === 42431 ? Chain.tempoModerato : Chain.tempo;
  return createPublicClient({
    chain,
    transport: http(rpcUrl(network), options),
  });
}

export function tokenDecimals() {
  return 6;
}

export function tokenSymbol(token: string, chain: number) {
  if (
    Object.values(machineTokenDeployments).some(
      (deployment) => token.toLowerCase() === deployment.token.toLowerCase(),
    )
  )
    return "MACH";
  return (
    tokens.tempo.find(
      (currency) =>
        (currency.addresses as Record<number, string>)[chain]?.toLowerCase() ===
        token.toLowerCase(),
    )?.symbol ?? token
  );
}

export const appUrl = process.env.TEMPO_AUTH_URL ?? "https://wallet.tempo.xyz";

export function normalizeNetwork(value: string) {
  if (value === "testnet" || value === "tempo-moderato" || value === "moderato") return "testnet";
  if (value === "mainnet" || value === "tempo") return "mainnet";
  throw usageError(`Unsupported network: ${value}`);
}
