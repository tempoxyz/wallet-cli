import type { MaybePromise } from './common.js';
import type { PaymentContext, PaymentRequirement } from './payment.js';
import type { ResolvedPaymentPolicy } from './policy.js';
/** Evidence that the payment asset was already held. */
export type AvailableReceipt = Readonly<{
    status: 'available';
    /** Network holding the payment asset. */
    network: string;
    asset: string;
    /** Atomic payment amount confirmed available. */
    amount: bigint;
}>;
/** Evidence that the payment asset was acquired; not proof of payment settlement. */
export type AcquiredReceipt = Readonly<{
    status: 'acquired';
    /** Route that performed the acquisition. */
    route: string;
    /** Funding asset spent. */
    input: Readonly<{
        network: string;
        asset: string;
        /** Quoted input that selected the route, in atomic units. */
        quotedAmount: bigint;
        /** Actual input reported by the route or provider; absent when only the quote is known. */
        amount?: bigint;
    }>;
    /** Payment asset acquired; `amount` is the acquired shortfall in atomic units. */
    output: Readonly<{
        network: string;
        asset: string;
        amount: bigint;
    }>;
    /** Source-specific transaction or completion reference. */
    reference?: string;
}>;
/** Evidence that a payment asset was already available or acquired. */
export type FundingReceipt = AvailableReceipt | AcquiredReceipt;
/**
 * Data returned after a funder prepares a selected payment. `context` is credential context for
 * the protocol adapter; its type is fixed by the adapter's {@link PaymentClient} parameter.
 */
export type PaymentPreparation<context = never> = Readonly<{
    context?: context;
    /** Optional funding evidence; does not establish final payment settlement. */
    funding?: FundingReceipt;
}>;
/** Context available while a funder prepares funds. */
export type FundContext = PaymentContext & Readonly<{
    /** Validated funding controls that custom funders are responsible for enforcing. */
    policy: ResolvedPaymentPolicy;
}>;
/**
 * Resolves payment metadata and makes the requested asset available. `context` is the credential
 * context type it may return; the default `never` fits every payment client.
 */
export type Funder<context = never> = Readonly<{
    /** Stable funder name used for identification and observability. */
    name: string;
    /** Declares that preparation enforces every configured `maxFundingSpend` ceiling. */
    enforcesFundingSpend?: boolean;
    /**
     * Return undefined to decline, or enrich missing metadata while preserving the selected payment.
     * Funders are tried in order; omitting resolve makes this funder a catch-all.
     */
    resolve?(requirement: PaymentRequirement): MaybePromise<PaymentRequirement | undefined>;
    /**
     * Called only for the first matching funder, after policy validation.
     * Ensure the requested balance or return adapter context; rejection aborts credential creation.
     */
    prepare(requirement: PaymentRequirement, context: FundContext): MaybePromise<PaymentPreparation<context> | undefined>;
}>;
/**
 * A selected payment after metadata resolution and policy validation. Only plans returned by
 * `planPayment` can be funded; copies and hand-built plans are rejected.
 */
export type PaymentPlan<context = never> = Readonly<{
    requirement: PaymentRequirement;
    policy: ResolvedPaymentPolicy;
    /** The first matching funder; absent when the payment proceeds directly. */
    funder?: Funder<context>;
}>;
//# sourceMappingURL=funder.d.ts.map