import { formatUnits, isAddress, parseUnits } from "viem";
import { Actions, Addresses } from "viem/tempo";

import { usageError } from "../shared/errors.js";
import { chainId, createTempoPublicClient } from "../shared/network.js";
import { cleanStoredScalar, getRecord, stringValue } from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { selectPaymentCapableAccessKey } from "../wallet/access-key.js";
import { loadWalletState } from "../wallet/store.js";

const slippageScale = 10_000n;

type SwapDependencies = {
  getBalance: (options: { account: `0x${string}`; token: `0x${string}` }) => Promise<bigint>;
  getMetadata: (token: `0x${string}`) => Promise<{ decimals: number; symbol: string }>;
  getBuyQuote: (options: {
    amountOut: bigint;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
  }) => Promise<bigint>;
  getSellQuote: (options: {
    amountIn: bigint;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
  }) => Promise<bigint>;
  submit: (options: {
    calls: readonly { data: `0x${string}`; to: `0x${string}` }[];
    feeToken: `0x${string}`;
    network?: string | undefined;
  }) => Promise<string>;
};

export async function swapTokens(
  input: {
    args: { amount: string; tokenIn: string; tokenOut: string };
    options: {
      network?: string | undefined;
      "dry-run"?: boolean | undefined;
      "exact-out"?: boolean | undefined;
      "fee-token"?: string | undefined;
      "slippage-bps": number;
      yes?: boolean | undefined;
    };
  },
  dependencies: Partial<SwapDependencies> = {},
) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  if (!isAddress(input.args.tokenIn) || !isAddress(input.args.tokenOut))
    throw usageError("Invalid token address: expected full 0x addresses for tokenIn and tokenOut");
  if (input.args.tokenIn.toLowerCase() === input.args.tokenOut.toLowerCase())
    throw usageError("Invalid swap: tokenIn and tokenOut must be different");
  if (
    !Number.isSafeInteger(input.options["slippage-bps"]) ||
    input.options["slippage-bps"] < 0 ||
    input.options["slippage-bps"] > 10_000
  )
    throw usageError("Invalid slippage: --slippage-bps must be between 0 and 10000");
  if (input.options["fee-token"] && !isAddress(input.options["fee-token"]))
    throw usageError("Invalid fee token address: expected a full 0x address");

  const tokenIn = input.args.tokenIn.toLowerCase() as `0x${string}`;
  const tokenOut = input.args.tokenOut.toLowerCase() as `0x${string}`;
  const selectedChainId = chainId(input.options.network);
  const runtime = { ...defaultDependencies(input.options.network), ...dependencies };
  const [metadataIn, metadataOut] = await Promise.all([
    runtime.getMetadata(tokenIn),
    runtime.getMetadata(tokenOut),
  ]);
  const exactOut = input.options["exact-out"] === true;
  const amount = parseSwapAmount(
    input.args.amount,
    exactOut ? metadataOut.decimals : metadataIn.decimals,
  );
  const quote = exactOut
    ? await runtime.getBuyQuote({ amountOut: amount, tokenIn, tokenOut })
    : await runtime.getSellQuote({ amountIn: amount, tokenIn, tokenOut });
  const slippageBps = BigInt(input.options["slippage-bps"]);
  const amountIn = exactOut ? quote : amount;
  const amountOut = exactOut ? amount : quote;
  const maxAmountIn = exactOut
    ? divideRoundUp(quote * (slippageScale + slippageBps), slippageScale)
    : amount;
  const minAmountOut = exactOut ? amount : (quote * (slippageScale - slippageBps)) / slippageScale;
  const balance = await runtime.getBalance({
    account: activeAccount.address as `0x${string}`,
    token: tokenIn,
  });
  if (maxAmountIn > balance)
    throw usageError(
      `Insufficient ${metadataIn.symbol} balance: need up to ${formatUnits(maxAmountIn, metadataIn.decimals)}, have ${formatUnits(balance, metadataIn.decimals)}`,
    );

  const approve = Actions.token.approve.call({
    amount: maxAmountIn,
    spender: Addresses.stablecoinDex,
    token: tokenIn,
  });
  const swap = exactOut
    ? Actions.dex.buy.call({ amountOut, maxAmountIn, tokenIn, tokenOut })
    : Actions.dex.sell.call({ amountIn, minAmountOut, tokenIn, tokenOut });
  const calls = [approve, swap] as const;
  const key = selectPaymentCapableAccessKey(state.accessKeys, {
    chainId: selectedChainId,
    walletAddress: activeAccount.address,
  });
  const accessKeyLimit = key?.limits.find((limit) => limit.token.toLowerCase() === tokenIn);
  const accessKeyLimitRaw = parseAccessKeyLimit(accessKeyLimit?.limit);
  const requiresAccessKeyUpdate = accessKeyLimitRaw === null || accessKeyLimitRaw < maxAmountIn;
  const feeToken = (input.options["fee-token"]?.toLowerCase() ?? tokenIn) as `0x${string}`;
  const output = {
    chain_id: selectedChainId,
    mode: exactOut ? ("exact_out" as const) : ("exact_in" as const),
    from: activeAccount.address.toLowerCase(),
    dex: Addresses.stablecoinDex.toLowerCase(),
    token_in: tokenIn,
    token_in_symbol: metadataIn.symbol,
    token_out: tokenOut,
    token_out_symbol: metadataOut.symbol,
    amount_in: formatUnits(amountIn, metadataIn.decimals),
    max_amount_in: formatUnits(maxAmountIn, metadataIn.decimals),
    amount_out: formatUnits(amountOut, metadataOut.decimals),
    min_amount_out: formatUnits(minAmountOut, metadataOut.decimals),
    slippage_bps: input.options["slippage-bps"],
    fee_token: feeToken,
    access_key_limit:
      accessKeyLimitRaw === null ? null : formatUnits(accessKeyLimitRaw, metadataIn.decimals),
    requires_access_key_update: requiresAccessKeyUpdate,
    calls: calls.map((call) => ({ to: call.to.toLowerCase(), data: call.data })),
  };

  if (input.options["dry-run"]) return { status: "dry_run" as const, ...output };
  if (!input.options.yes)
    throw usageError("Swap not submitted: review the quote with --dry-run, then pass --yes");
  if (requiresAccessKeyUpdate)
    throw usageError(
      `Active access key cannot spend ${formatUnits(maxAmountIn, metadataIn.decimals)} ${metadataIn.symbol}. Ask the wallet owner to run 'tempo wallet keys update --token ${tokenIn} --limit ${formatUnits(maxAmountIn, metadataIn.decimals)}' and retry.`,
    );

  const txHash = await runtime.submit({ calls, feeToken, network: input.options.network });
  return { status: "success" as const, tx_hash: txHash, ...output };
}

function parseSwapAmount(value: string, decimals: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw usageError("Invalid amount: expected a positive token amount");
  try {
    const amount = parseUnits(value, decimals);
    if (amount <= 0n) throw new Error("non-positive amount");
    return amount;
  } catch {
    throw usageError(
      `Invalid amount: expected a positive amount with at most ${decimals} decimals`,
    );
  }
}

function divideRoundUp(value: bigint, divisor: bigint) {
  return (value + divisor - 1n) / divisor;
}

function parseAccessKeyLimit(value: string | undefined) {
  if (!value) return null;
  try {
    return BigInt(cleanStoredScalar(value));
  } catch {
    return null;
  }
}

function defaultDependencies(network: string | undefined): SwapDependencies {
  const client = createTempoPublicClient(network);
  return {
    async getBalance(options) {
      return (await Actions.token.getBalance(client, options)).amount;
    },
    async getMetadata(token) {
      const metadata = await Actions.token.getMetadata(client, { token });
      return { decimals: metadata.decimals, symbol: metadata.symbol || token };
    },
    async getBuyQuote(options) {
      return Actions.dex.getBuyQuote(client, options);
    },
    async getSellQuote(options) {
      return Actions.dex.getSellQuote(client, options);
    },
    async submit(options) {
      const provider = createProvider({ network: options.network });
      const receipt = await provider.request({
        method: "eth_sendTransactionSync",
        params: [{ calls: options.calls, feeToken: options.feeToken }],
      });
      const record = getRecord(receipt);
      const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
      if (!txHash) throw new Error("Swap submitted but receipt did not include a transaction hash");
      return txHash;
    },
  };
}
