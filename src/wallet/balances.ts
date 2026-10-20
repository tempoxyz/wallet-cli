import { formatUnits, isAddress } from "viem";

import { appUrl } from "../shared/network.js";
import { knownTokens, tickerSymbol, tokenSymbol } from "../shared/tokens.js";
import { getArray, getRecord } from "../shared/utils.js";
import { rpcChainCheck, statusQueryTimeout, tokenBalance } from "./key-output.js";

/**
 * A token balance in base units. Only a token a list vouches for is `verified`; an unverified
 * token's symbol is its own.
 */
export type WalletAsset = {
  address: string;
  balance: bigint;
  decimals: number;
  symbol: string | null;
  verified: boolean;
};

/**
 * The wallet app's nonzero assets, with MACH read on chain as a fallback, including zero.
 * Like the default currency, an asset the app reports takes precedence over its on-chain read.
 */
export async function fetchWalletAssets(options: {
  chain: number;
  walletAddress: string | null;
  servesChain?: (chain: number) => Promise<boolean>;
}): Promise<WalletAsset[]> {
  if (!options.walletAddress) return [];
  const mach = knownTokens(options.chain).find((token) => token.symbol === "MACH");
  const [assets, balance] = await Promise.all([
    fetchAppAssets(options.chain, options.walletAddress),
    mach
      ? tokenBalance({
          ...options,
          token: mach.address,
          servesChain: options.servesChain ?? rpcChainCheck(),
        })
      : null,
  ]);
  if (mach && balance && !assets.some((asset) => asset.address.toLowerCase() === mach.address))
    assets.push({ ...mach, balance: balance.raw, verified: true });
  return assets;
}

/** Nonzero balances from the wallet app; empty when its response is unavailable or malformed. */
async function fetchAppAssets(chain: number, walletAddress: string): Promise<WalletAsset[]> {
  const url = new URL("/api/assets", appUrl);
  url.searchParams.set("address", walletAddress);
  url.searchParams.set("chainId", String(chain));
  url.searchParams.set("fresh", "true");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(statusQueryTimeout) });
    if (!response.ok) return [];
    return getArray(await response.json()).flatMap((value) => {
      const asset = getRecord(value);
      if (
        typeof asset.address !== "string" ||
        !isAddress(asset.address) ||
        typeof asset.balance !== "string" ||
        !/^\d+$/.test(asset.balance) ||
        BigInt(asset.balance) === 0n ||
        typeof asset.decimals !== "number" ||
        !Number.isInteger(asset.decimals) ||
        asset.decimals < 0 ||
        asset.decimals > 77 ||
        typeof asset.symbol !== "string"
      )
        return [];
      return [
        {
          address: asset.address,
          balance: BigInt(asset.balance),
          decimals: asset.decimals,
          symbol: tokenSymbol(asset.address, chain) ?? tickerSymbol(asset.symbol),
          verified: asset.verified === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * The `assets` balances in their decimals, by lowercase token, then `fallback`, a balance read on
 * chain, unless `assets` has its token: the wallet app leaves out zero balances, and reports none
 * when it is unreachable.
 */
export function assetBalances(assets: readonly WalletAsset[], fallback?: WalletAsset) {
  const listed =
    fallback &&
    !assets.some((asset) => asset.address.toLowerCase() === fallback.address.toLowerCase())
      ? [...assets, fallback]
      : assets;
  return listed.map((asset) => ({
    token: asset.address.toLowerCase(),
    symbol: asset.symbol,
    decimals: asset.decimals,
    balance: formatUnits(asset.balance, asset.decimals),
    verified: asset.verified,
  }));
}
