import { type Address } from 'viem';
import { type Token } from 'viem/tokens';
import type { Funder, PaymentPreparation } from '../interfaces/funder.js';
/**
 * Tempo auto-swap settings for Mppx payments. `false` never swaps; `true` swaps from pathUSD and
 * USDC; `{ tokens }` also trusts and swaps from the given Viem tokens, first and in order.
 */
export type TempoAutoSwap = boolean | Readonly<{
    /**
     * Viem tokens to swap from first, in order, on each chain in their `addresses`. They are also
     * trusted payment tokens: a Tempo payment in one resolves the token's `currency` and
     * `decimals`, which a currency `maxPayment` needs. Each must declare a `currency`. Mppx
     * appends pathUSD and USDC to every swap list, so this sets priority and is not an allowlist.
     * @default []
     */
    tokens?: readonly Token[] | undefined;
}>;
/** Mppx Tempo charge context machine-fetch supplies for each Tempo payment. */
export type TempoContext = Readonly<{
    /**
     * `false` disables auto-swap for the payment. Otherwise Mppx tries `tokenIn` in order, then its
     * own pathUSD and USDC defaults, with `slippage` in percent.
     */
    autoSwap: false | Readonly<{
        tokenIn: readonly Address[];
        slippage: number;
    }>;
}>;
/** Whether a credential context came from the built-in Tempo funder. */
export declare function isTempoContext(context: unknown): context is TempoContext;
/** Context that stops Mppx from swapping, whatever the method's own auto-swap setting. */
export declare const autoSwapDisabled: PaymentPreparation<TempoContext>;
/**
 * The funder every Mppx entry point adds after the configured ones. It trusts metadata only for
 * known tokens, and supplies auto-swap context from machine-fetch policy immediately before
 * signing, so policy overrides the method's own auto-swap setting.
 */
export declare function tempoFunder(autoSwap?: TempoAutoSwap): Funder<TempoContext>;
