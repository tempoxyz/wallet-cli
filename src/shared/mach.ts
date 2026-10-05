import { machineTokenDeployments } from "mppx/tempo";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";

import { usageError } from "./errors.js";
import { createTempoPublicClient } from "./network.js";

export const machDecimals = 6;

export function machToken(chain: number) {
  const deployment = machineTokenDeployments[chain as keyof typeof machineTokenDeployments];
  if (!deployment) throw usageError(`MACH is not supported on chain ${chain}`);
  return deployment.token;
}

export function machFundingToken(chain: number) {
  if (chain !== 4217)
    throw usageError(`MACH funding is not supported on chain ${chain}; use mainnet (4217)`);
  return machToken(chain);
}

export function fundingAmount(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || parseUnits(value, 6) <= 0n)
    throw usageError("--amount must be a positive USD decimal with at most 6 decimal places");
  const raw = parseUnits(value, 6);
  if (raw >= 2n ** 256n) throw usageError("--amount exceeds the token amount limit");
  return raw;
}

/** Hosted MACH checkout accepts $5–$100 with cent precision. */
export function machFundingAmount(value: string | undefined) {
  const raw = fundingAmount(value);
  if (
    value !== undefined &&
    (raw! < 5_000_000n || raw! > 100_000_000n || !/^\d+(?:\.\d{1,2})?$/.test(value))
  )
    throw usageError(
      "MACH funding --amount must be between 5 and 100 USD with at most 2 decimal places",
    );
  return raw;
}

export function requireWalletAddress(value: string) {
  if (!isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value))
    throw usageError("Invalid wallet address");
  return value.toLowerCase() as `0x${string}`;
}

export async function queryMachBalance(options: { chainId: number; walletAddress: string }) {
  const token = machToken(options.chainId);
  const wallet = requireWalletAddress(options.walletAddress);
  const rawBalance = await createTempoPublicClient(
    options.chainId === 42431 ? "testnet" : "mainnet",
    {
      timeout: 10_000,
      retryCount: 0,
    },
  ).readContract({
    abi: erc20Abi,
    address: token,
    functionName: "balanceOf",
    args: [wallet],
  });
  return {
    wallet,
    chain_id: options.chainId,
    token,
    symbol: "MACH" as const,
    decimals: machDecimals,
    balance: formatUnits(rawBalance, machDecimals),
    raw_balance: rawBalance.toString(),
  };
}

export function warnCreditsAlias() {
  console.error(
    "--credits is deprecated and now selects on-chain MACH. Legacy Coinflow credits are not read, redeemed, or converted.",
  );
}
