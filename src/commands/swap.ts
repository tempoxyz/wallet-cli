import { formatUnits, toHex } from "viem";
import { Actions, Addresses } from "viem/tempo";

import {
  commandError,
  paymentOutcomeUnknownError,
  usageError,
  walletError,
} from "../shared/errors.js";
import { machToken } from "../shared/mach.js";
import {
  createTempoPublicClient,
  networkFields,
  networkName,
  storedChainId,
  type Network,
} from "../shared/network.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import type { Wallet } from "../shared/require-wallet.js";
import { resolveTokenAddress, tokenLabel, tokenMetadata } from "../shared/tokens.js";
import { cleanStoredScalar, getRecord, parseTokenAmount, stringValue } from "../shared/utils.js";
import { createProvider, requireSender } from "../provider.js";

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
    from: `0x${string}`;
    network: Network;
  }) => Promise<string>;
};

export async function swapTokens(
  wallet: Wallet,
  input: {
    args: { amount: string; tokenIn: string; tokenOut: string };
    options: {
      "dry-run"?: boolean | undefined;
      "exact-out"?: boolean | undefined;
      "fee-token"?: string | undefined;
      "max-amount-in"?: string | undefined;
      "min-amount-out"?: string | undefined;
      "slippage-bps": number;
      yes?: boolean | undefined;
    };
  },
  dependencies: Partial<SwapDependencies> = {},
) {
  const { account, key, network, state } = wallet;
  const selectedChainId = network.chainId;
  const tokenIn = resolveTokenAddress(input.args.tokenIn, network);
  const tokenOut = resolveTokenAddress(input.args.tokenOut, network);
  if (tokenIn === tokenOut)
    throw usageError("Invalid swap: tokenIn and tokenOut must be different");
  if (
    !Number.isSafeInteger(input.options["slippage-bps"]) ||
    input.options["slippage-bps"] < 0 ||
    input.options["slippage-bps"] > 10_000
  )
    throw usageError("Invalid slippage: --slippage-bps must be between 0 and 10000");
  const feeToken = input.options["fee-token"]
    ? resolveTokenAddress(input.options["fee-token"], network, "fee token")
    : tokenIn;
  const exactOut = input.options["exact-out"] === true;
  if (exactOut && input.options["min-amount-out"] !== undefined)
    throw usageError(
      "--min-amount-out applies to exact-input swaps; use --max-amount-in with --exact-out",
    );
  if (!exactOut && input.options["max-amount-in"] !== undefined)
    throw usageError("--max-amount-in applies to --exact-out swaps; use --min-amount-out instead");

  const mach = machToken(selectedChainId).toLowerCase();
  if (tokenIn === mach || tokenOut === mach)
    throw usageError(
      "MACH cannot be swapped. Use 'tempo request --mach' to pay for supported services.",
    );
  // Without an access key for the selected network, the wallet app approves the swap, and it
  // signs only on the chain the wallet is logged in on.
  const walletChainId = storedChainId(state);
  if (!input.options["dry-run"] && !key && walletChainId !== selectedChainId) {
    const command = continuationCommand(["wallet", "login"], network);
    return commandError(
      "E_USAGE",
      `Swap not submitted: wallet is logged in on ${networkName(walletChainId)}, not ${networkName(selectedChainId)}, and has no access key for ${networkName(selectedChainId)}; log in with '${command}', then rerun the swap.`,
      command,
    );
  }
  const runtime = { ...defaultDependencies(network), ...dependencies };
  const [metadataIn, metadataOut] = await Promise.all([
    tokenMetadata(tokenIn, selectedChainId, runtime.getMetadata),
    tokenMetadata(tokenOut, selectedChainId, runtime.getMetadata),
  ]);
  const nameIn = tokenLabel(metadataIn);
  const nameOut = tokenLabel(metadataOut);
  const amount = parseTokenAmount(
    input.args.amount,
    exactOut ? metadataOut.decimals : metadataIn.decimals,
  );
  const reviewedMinOut = parseSwapBound(
    input.options["min-amount-out"],
    metadataOut.decimals,
    "--min-amount-out",
  );
  const reviewedMaxIn = parseSwapBound(
    input.options["max-amount-in"],
    metadataIn.decimals,
    "--max-amount-in",
  );
  const quote = exactOut
    ? await runtime.getBuyQuote({ amountOut: amount, tokenIn, tokenOut })
    : await runtime.getSellQuote({ amountIn: amount, tokenIn, tokenOut });
  // A reviewed bound only tightens the slippage bound; a quote that cannot meet it is refused.
  if (reviewedMinOut !== undefined && quote < reviewedMinOut)
    throw quoteMovedError(
      `${input.args.amount} ${nameIn} now returns ${formatUnits(quote, metadataOut.decimals)} ${nameOut}, below --min-amount-out ${formatUnits(reviewedMinOut, metadataOut.decimals)}`,
      "--min-amount-out",
    );
  if (reviewedMaxIn !== undefined && quote > reviewedMaxIn)
    throw quoteMovedError(
      `${input.args.amount} ${nameOut} now costs ${formatUnits(quote, metadataIn.decimals)} ${nameIn}, above --max-amount-in ${formatUnits(reviewedMaxIn, metadataIn.decimals)}`,
      "--max-amount-in",
    );
  const slippageBps = BigInt(input.options["slippage-bps"]);
  const amountIn = exactOut ? quote : amount;
  const amountOut = exactOut ? amount : quote;
  const slippageMaxIn = divideRoundUp(quote * (slippageScale + slippageBps), slippageScale);
  const slippageMinOut = (quote * (slippageScale - slippageBps)) / slippageScale;
  const maxAmountIn = !exactOut
    ? amount
    : reviewedMaxIn !== undefined && reviewedMaxIn < slippageMaxIn
      ? reviewedMaxIn
      : slippageMaxIn;
  const minAmountOut = exactOut
    ? amount
    : reviewedMinOut !== undefined && reviewedMinOut > slippageMinOut
      ? reviewedMinOut
      : slippageMinOut;
  const balance = await runtime.getBalance({
    account: account.address as `0x${string}`,
    token: tokenIn,
  });
  if (maxAmountIn > balance)
    throw usageError(
      `Insufficient ${nameIn} balance: need up to ${formatUnits(maxAmountIn, metadataIn.decimals)}, have ${formatUnits(balance, metadataIn.decimals)}`,
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
  const accessKeyLimit = key?.limits?.find((limit) => limit.token.toLowerCase() === tokenIn);
  const accessKeyLimitRaw = parseAccessKeyLimit(accessKeyLimit?.limit);
  // A key stored without limits is unrestricted, and without a key the wallet app approves the
  // swap; only a limited key can fall short.
  const requiresAccessKeyUpdate =
    key?.limits !== undefined && (accessKeyLimitRaw === null || accessKeyLimitRaw < maxAmountIn);
  const output = {
    ...networkFields(selectedChainId),
    mode: exactOut ? ("exact_out" as const) : ("exact_in" as const),
    from: account.address.toLowerCase(),
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

  if (input.options["dry-run"]) {
    const next = !requiresAccessKeyUpdate
      ? nextStep(
          exactOut
            ? `Review the quote, then run the next command to submit it. Submission re-quotes and refuses to spend more than ${output.max_amount_in} ${nameIn}.`
            : `Review the quote, then run the next command to submit it. Submission re-quotes and refuses to receive less than ${output.min_amount_out} ${nameOut}.`,
          [
            "wallet",
            "swap",
            input.args.amount,
            tokenIn,
            tokenOut,
            ...(exactOut
              ? ["--exact-out", "--max-amount-in", output.max_amount_in]
              : ["--min-amount-out", output.min_amount_out]),
            "--slippage-bps",
            String(input.options["slippage-bps"]),
            ...(input.options["fee-token"] ? ["--fee-token", feeToken] : []),
            "--yes",
          ],
          { network },
        )
      : nextStep(
          `The active access key cannot spend ${output.max_amount_in} ${nameIn}. Ask the wallet owner to run the next command, then rerun this dry run to review the swap.`,
          [
            "wallet",
            "keys",
            "update",
            key.address,
            "--token",
            tokenIn,
            "--limit",
            output.max_amount_in,
          ],
          { network },
        );
    return { status: "dry_run" as const, ...output, ...next };
  }
  if (!input.options.yes)
    throw usageError("Swap not submitted: review the quote with --dry-run, then pass --yes");
  if (requiresAccessKeyUpdate)
    throw usageError(
      `Active access key cannot spend ${formatUnits(maxAmountIn, metadataIn.decimals)} ${nameIn}. Ask the wallet owner to run 'tempo wallet keys update --token ${tokenIn} --limit ${formatUnits(maxAmountIn, metadataIn.decimals)}' and retry.`,
    );

  const txHash = await runtime.submit({
    calls,
    feeToken,
    from: account.address as `0x${string}`,
    network,
  });
  return { status: "success" as const, tx_hash: txHash, ...output };
}

function parseSwapBound(value: string | undefined, decimals: number, flag: string) {
  if (value === undefined) return undefined;
  try {
    return parseTokenAmount(value, decimals);
  } catch {
    throw usageError(
      `Invalid ${flag}: expected a positive amount with at most ${decimals} decimals`,
    );
  }
}

function quoteMovedError(detail: string, flag: string) {
  return walletError({
    code: "E_LIMIT_EXCEEDED",
    message: `Quote moved: ${detail}. Rerun --dry-run without ${flag} to review a new quote.`,
  });
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

function defaultDependencies(network: Network): SwapDependencies {
  const client = createTempoPublicClient(network.chainId);
  return {
    async getBalance(options) {
      return (await Actions.token.getBalance(client, options)).amount;
    },
    async getMetadata(token) {
      return Actions.token.getMetadata(client, { token });
    },
    async getBuyQuote(options) {
      return Actions.dex.getBuyQuote(client, options);
    },
    async getSellQuote(options) {
      return Actions.dex.getSellQuote(client, options);
    },
    async submit(options) {
      const provider = await createProvider({ network: options.network });
      const receipt = await provider.request({
        method: "eth_sendTransactionSync",
        // Without a chain the provider sends on the one the wallet store last saved.
        params: [
          {
            from: requireSender(provider, options.from),
            calls: options.calls,
            chainId: toHex(options.network.chainId),
            feeToken: options.feeToken,
          },
        ],
      });
      const record = getRecord(receipt);
      const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
      if (!txHash)
        throw paymentOutcomeUnknownError(
          "Swap submitted but receipt did not include a transaction hash; check the wallet balance before retrying.",
        );
      return txHash;
    },
  };
}
