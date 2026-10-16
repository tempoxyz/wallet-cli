import { formatUnits, isAddress } from "viem";

import { appUrl } from "../shared/network.js";
import { tickerSymbol, tokenSymbol } from "../shared/tokens.js";
import { getArray, getRecord } from "../shared/utils.js";
import { statusQueryTimeout } from "./key-output.js";

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
 * The nonzero token balances the wallet app reports for `walletAddress` on `chain`, each with its
 * listed symbol, else its own sanitized when it is a plain ticker. Empty when the app is
 * unreachable or its answer is malformed.
 */
export async function fetchWalletAssets(options: {
  chain: number;
  walletAddress: string | null;
}): Promise<WalletAsset[]> {
  if (!options.walletAddress) return [];
  const url = new URL("/api/assets", appUrl);
  url.searchParams.set("address", options.walletAddress);
  url.searchParams.set("chainId", String(options.chain));
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
          symbol: tokenSymbol(asset.address, options.chain) ?? tickerSymbol(asset.symbol),
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
