import type { Challenge } from 'mppx';
import { Mppx, type Transport } from 'mppx/client';
import type { MaybePromise } from '../interfaces/common.js';
import type { FundingReceipt } from '../interfaces/funder.js';
import type { MachineFetch, MachineFetchOptions, PaymentClient, PaymentRequirement } from '../interfaces/payment.js';
/** Mppx CLI payment-extension contract, also usable by hosts that drive Mppx directly. */
export type MppxExtension = Readonly<{
    preparePayment(context: Readonly<{
        challenge: Challenge.Challenge;
        credentialContext?: unknown;
        signal?: AbortSignal;
        /**
         * Caller-chosen attempt ID; defaults to a random UUID. Persist it before calling so funding
         * interrupted by a crash can be recovered; use one ID per payment.
         */
        attemptId?: string;
        /** Account that will sign the credential; funders reject delivering funds to another. */
        payer?: string;
    }>): MaybePromise<MppxPreparation | undefined>;
}>;
/** Credential context for Mppx and, when a funder reported it, the funding evidence. */
export type MppxPreparation = Readonly<{
    /** Replaces the method-specific context supplied to credential creation. */
    credentialContext?: unknown;
    /** Funding evidence from the funder; not proof of payment settlement. */
    funding?: FundingReceipt;
}>;
/** Machine-fetch options accepted by {@link extension}; funders may return any Mppx context. */
export type MppxExtensionOptions = Readonly<Omit<MachineFetchOptions<unknown>, 'client'> & {
    /** Combines existing method context with context returned by a funder. */
    compose?(current: unknown, prepared: unknown): unknown;
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
export type FromMppxOptions<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = Readonly<Omit<Mppx.create.Config<methods, transport>, 'fetch' | 'methods' | 'onChallenge' | 'polyfill' | 'transport'>>;
/** Mppx and machine-fetch options for the direct Fetch wrapper; funders may return Mppx context. */
export type MppxFetchOptions<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = Readonly<Omit<Mppx.create.Config<methods, transport>, 'onChallenge' | 'polyfill'> & Omit<MachineFetchOptions<unknown>, 'client'>>;
/** Creates a paid Fetch function from Mppx methods and machine-fetch policy. */
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
 * host's attempt ID, or a random one, and the host's signal, when it supplies one.
 */
export declare function extension(options?: MppxExtensionOptions): MppxExtension;
/** Converts an MPP or Mppx-translated x402 challenge to the common model. */
export declare function mppxRequirement(challenge: Challenge.Challenge): PaymentRequirement;
//# sourceMappingURL=mppx.d.ts.map