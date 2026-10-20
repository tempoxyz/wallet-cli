import type { Challenge } from 'mppx';
import { Mppx, type Transport } from 'mppx/client';
import { type TempoAutoSwap } from '../funders/tempo.js';
import type { FundingReceipt } from '../interfaces/funder.js';
import type { MachineFetch, MachineFetchOptions, PaymentClient, PaymentRequirement } from '../interfaces/payment.js';
/** Mppx CLI payment-extension contract, also usable by hosts that drive Mppx directly. */
export type MppxExtension = Readonly<{
    preparePayment(context: Readonly<{
        challenge: Challenge.Challenge;
        credentialContext?: unknown;
        signal?: AbortSignal | undefined;
        /**
         * Caller-chosen operation ID. Persist it before calling so funding interrupted by a crash
         * can be recovered; use one ID per payment.
         * @default crypto.randomUUID()
         */
        operationId?: string | undefined;
        /**
         * Account that will sign the credential; funders reject delivering funds to another. Defaults
         * to the extension's configured `payer` and must match it when both are set.
         */
        payer?: string | undefined;
    }>): MppxPreparation | undefined | Promise<MppxPreparation | undefined>;
}>;
/** Credential context for Mppx and, when a funder reported it, the funding evidence. */
export type MppxPreparation = Readonly<{
    /** Replaces the method-specific context supplied to credential creation. */
    credentialContext?: unknown;
    /** Funding evidence from the funder; not proof of payment settlement. */
    funding?: FundingReceipt | undefined;
}>;
/** Tempo auto-swap setting shared by every Mppx entry point. */
export type MppxAutoSwapOptions = Readonly<{
    /**
     * Swaps into the requested Tempo stablecoin atomically with payment, through Mppx and the Tempo
     * Stablecoin DEX, under machine-fetch's `maxSlippageBps` and `sameCurrencyOnly`. `false` never
     * swaps; `{ tokens }` adds Viem tokens to trust and swap from first. Machine-fetch supplies this
     * per payment, so it overrides the Tempo method's own `autoSwap`. Mppx cannot cap a swap's input,
     * so a policy with `maxFundingSpend` must set `false`.
     * @default true
     */
    autoSwap?: TempoAutoSwap | undefined;
}>;
/** Machine-fetch options accepted by {@link mppxExtension}; funders may return any Mppx context. */
export type MppxExtensionOptions = Readonly<Omit<MachineFetchOptions<unknown>, 'client'> & MppxAutoSwapOptions & {
    /** Combines existing method context with context returned by a funder. */
    compose?: ((current: unknown, prepared: unknown) => unknown) | undefined;
}>;
/** Public Mppx client accepted by {@link fromMppx}. */
export type MppxClient<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = Readonly<{
    methods: methods;
    rawFetch: Mppx.Mppx<readonly [], transport>['rawFetch'];
    transport: transport;
}>;
/**
 * Mppx create-time settings that an existing client does not expose: `attestation`,
 * `acceptPaymentPolicy`, `maxPaymentRetries`, `orderChallenges`, and `paymentPreferences`.
 */
export type FromMppxOptions<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = Readonly<Omit<Mppx.create.Config<methods, transport>, 'fetch' | 'methods' | 'onChallenge' | 'polyfill' | 'transport'> & MppxAutoSwapOptions>;
/** Mppx and machine-fetch options for the direct Fetch wrapper; funders may return Mppx context. */
export type MppxFetchOptions<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = Readonly<Omit<Mppx.create.Config<methods, transport>, 'onChallenge' | 'polyfill'> & Omit<MachineFetchOptions<unknown>, 'client'> & MppxAutoSwapOptions>;
/** Creates a paid Fetch function from Mppx methods plus machine-fetch funders and policy. */
export declare function mppxFetch<const methods extends Mppx.Methods, const transport extends Transport.AnyTransport = Transport.Transport>(options: MppxFetchOptions<methods, transport>): MachineFetch;
/**
 * Adapts an existing Mppx client, reusing its methods, transport, and raw fetch. Mppx does not
 * expose its other create-time settings, so supply `attestation`, `acceptPaymentPolicy`,
 * `maxPaymentRetries`, `orderChallenges`, and `paymentPreferences` again in `options`; omitted
 * settings take Mppx's defaults for an unpolyfilled client, so `acceptPaymentPolicy` defaults to
 * `'always'`. The client's `onChallenge` and event handlers are not used.
 */
export declare function fromMppx<const methods extends Mppx.Methods, const transport extends Transport.AnyTransport>(client: MppxClient<methods, transport>, options?: FromMppxOptions<methods, transport>): PaymentClient<unknown>;
/**
 * Creates an Mppx CLI extension backed by machine-fetch policy and funders. Each payment uses the
 * host's operation ID, or a random one, and the host's signal, when it supplies one.
 */
export declare function mppxExtension(options?: MppxExtensionOptions): MppxExtension;
/** Converts an MPP or Mppx-translated x402 challenge to the common model. */
export declare function mppxRequirement(challenge: Challenge.Challenge): PaymentRequirement;
