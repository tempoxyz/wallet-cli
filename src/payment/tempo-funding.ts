import { InsufficientFundsError } from "machine-fetch";
import { tempoDex, type TempoDexContext } from "machine-fetch/funders/tempo";
import type { Funder, PaymentRequirement } from "machine-fetch/interfaces";
import { type Address, decodeFunctionData, erc20Abi } from "viem";
import { Addresses, Transaction as TempoTransaction } from "viem/tempo";

import { tempoFundingInputs, tempoUsdTokens } from "../shared/chains.js";
import { stringValue } from "../shared/utils.js";

/** Mppx Tempo charge context: `tempoDex`'s, with the swap's inputs as an allowlist. */
export type TempoFundingContext =
  | {
      autoSwap: Exclude<TempoDexContext["autoSwap"], false> & { fallback: false };
    }
  | TempoDexContext;

/** What a swap is about to spend: its first input the payer holds enough of, and at most how much. */
export type SwapInput = { token: Address; maxAmount: bigint; requirement: PaymentRequirement };

export type TempoFundingOptions = {
  chainId: number;
  /** The payer's balance of `token`, in atomic units. */
  balance(token: Address): Promise<bigint>;
  /** Runs before a swap is offered to the payment; throw to refuse it before signing. */
  beforeSwap?(input: SwapInput): void | Promise<void>;
  /**
   * Whether the payer's signer may spend `maxAmount` of `token`, such as within an access key's
   * limits. An input it may not spend is skipped for the next; when the payer holds enough only of
   * inputs it may not spend, the first of them goes to `beforeSwap`, which names the fix.
   */
  canSpend?(input: SwapInput): Promise<boolean>;
};

/**
 * Same-chain funding on Tempo (Phase 2): when the payer lacks the requested USD token, the payment
 * buys it on the Tempo DEX from OUSD, USDC.e, or pathUSD in the same transaction, through
 * machine-fetch's `tempoDex` and Mppx auto-swap, with slippage from policy.
 *
 * The balance is read first: a payer that already holds the token gets an `available` receipt and
 * no swap context, and one whose balance cannot be read pays as it would without funding. Mppx
 * would append pathUSD and USDC.e to the swap's inputs; `fallback: false` ([mppx-1]) makes the
 * configured inputs an allowlist instead. A swap none of them can cover is refused before signing,
 * and the input Mppx tries first goes to `beforeSwap`. A swap of USD stablecoins is estimated at
 * parity plus slippage.
 */
export function tempoFunding(options: TempoFundingOptions): Funder<TempoFundingContext> {
  const { chainId } = options;
  const inputs = tempoFundingInputs(chainId);
  const dex = tempoDex({ chainId, preferredInputs: inputs, outputs: tempoUsdTokens(chainId) });
  return Object.freeze({
    name: dex.name,
    resolve: (requirement: PaymentRequirement) => dex.resolve?.(requirement),
    async prepare(requirement, context) {
      // A zero-amount proof moves nothing, so there is nothing to fund.
      if (requirement.amount === 0n) return undefined;
      const asset = requirement.asset as Address;
      const held = await options.balance(asset).catch(() => undefined);
      if (typeof held !== "bigint") return undefined;
      if (held >= requirement.amount)
        return Object.freeze({
          funding: Object.freeze({
            status: "available" as const,
            network: requirement.network,
            asset,
            amount: requirement.amount,
          }),
        });
      const prepared = await dex.prepare(requirement, context);
      const autoSwap = prepared?.context?.autoSwap;
      if (!autoSwap) return prepared;
      const maxAmount = withSlippage(requirement.amount, context.policy.maxSlippageBps);
      let unspendable: SwapInput | undefined;
      for (const token of autoSwap.tokenIn) {
        const balance = await options.balance(token).catch(() => undefined);
        if (typeof balance !== "bigint" || balance < maxAmount) continue;
        const input = { token, maxAmount, requirement };
        if (options.canSpend && !(await options.canSpend(input))) {
          unspendable ??= input;
          continue;
        }
        await options.beforeSwap?.(input);
        // Only the chosen input: Mppx would otherwise try any listed token it holds enough of,
        // including one the signer may not spend.
        return Object.freeze({
          context: Object.freeze({
            autoSwap: Object.freeze({ ...autoSwap, tokenIn: [token], fallback: false as const }),
          }),
        });
      }
      if (unspendable) await options.beforeSwap?.(unspendable);
      throw new InsufficientFundsError(
        `The wallet holds neither ${requirement.amount} of ${asset} (atomic units) nor enough of ${autoSwap.tokenIn.join(", ")} to swap for it`,
      );
    },
  });
}

/** `amount` raised by `bps` basis points, rounded up, as the most a swap for it may spend. */
export function withSlippage(amount: bigint, bps: number) {
  return (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

/**
 * The swap a pulled Tempo charge credential's signed transaction makes before paying: its input
 * token and approved maximum. Mppx prepends an approve of the DEX and a buy to the transfer.
 * `undefined` for any other credential.
 */
export function signedSwap(payload: Record<string, unknown>) {
  try {
    if (payload.type !== "transaction") return undefined;
    const { calls } = TempoTransaction.deserialize(
      stringValue(payload.signature) as `0x76${string}`,
    );
    const [approve, buy] = calls ?? [];
    const dex = Addresses.stablecoinDex.toLowerCase();
    if (!approve?.to || !approve.data || buy?.to?.toLowerCase() !== dex) return undefined;
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    if (functionName !== "approve" || args[0].toLowerCase() !== dex) return undefined;
    return { token: approve.to.toLowerCase() as Address, maxAmount: args[1] };
  } catch {
    return undefined;
  }
}
