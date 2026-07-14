import { createPublicClient, http, type Address } from "viem";
import { Chain } from "viem/tempo";

import { mainnetEscrow, moderatoEscrow, moderatoToken, usdcToken } from "./constants.js";

export function chainId(network: string | undefined) {
  return network === "testnet" ? 42431 : 4217;
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

export function createTempoPublicClient(network: string | undefined) {
  const chain = chainId(network) === 42431 ? Chain.tempoModerato : Chain.tempo;
  return createPublicClient({
    chain,
    transport: http(rpcUrl(network)),
  });
}

export function tokenDecimals() {
  return 6;
}

export function tokenSymbol(token: string) {
  if (token.toLowerCase() === usdcToken) return "USDC.e";
  if (token.toLowerCase() === moderatoToken) return "PathUSD";
  return token;
}

export function authUrl(chain: number | null) {
  if (process.env.TEMPO_AUTH_URL) return process.env.TEMPO_AUTH_URL;
  if (chain === 42431) return "https://wallet.tempo.xyz/cli-auth";
  return "https://wallet.tempo.xyz/cli-auth";
}
