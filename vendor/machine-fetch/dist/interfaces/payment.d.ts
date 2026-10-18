import type { MaybePromise } from './common.js';
import type { Funder, FundingReceipt, PaymentPreparation } from './funder.js';
import type { PaymentPolicy } from './policy.js';
/** A chain-agnostic payment challenge selected by a protocol client. */
export type PaymentRequirement = Readonly<{
    /** Wire protocol selected by the payment client, such as mpp or x402. */
    protocol: string;
    /** Protocol payment method or scheme, such as tempo or exact. */
    method: string;
    /** Selected payment intent, such as charge. */
    intent: string;
    /** Network identifier; EVM adapters use CAIP-2 eip155:<chainId>. */
    network: string;
    /** Payment asset identifier on the selected network; a symbol is not an asset address. */
    asset: string;
    /** Non-negative payment amount in atomic units of asset. */
    amount: bigint;
    /** Recipient selected by the protocol client; funders must preserve it. */
    recipient?: string;
    /** Resource selected by the protocol client; funders must preserve it. */
    resource?: string;
    /** Reference currency used for display-value limits and same-currency funding. */
    currency?: string;
    /** Number of atomic decimal places, an integer from 0 to 255, used for display-value limits. */
    decimals?: number;
    /** Protocol data may be untrusted. Never include credentials, signatures, or private keys. */
    metadata?: Readonly<Record<string, unknown>>;
}>;
/** Identity and cancellation of one paid Fetch call, shared by every hook and funder it reaches. */
export type PaymentContext = Readonly<{
    /**
     * Correlates events and funding work for one Fetch call. Random unless supplied through
     * {@link MachineFetch.withAttempt}; supply and persist it to recover funding after a crash.
     */
    attemptId: string;
    /** Request cancellation; abort does not prove that funds have not moved. */
    signal: AbortSignal;
    /**
     * Account that will sign the payment credential, when the host knows it. Funders that deliver
     * funds to an account reject a payment whose payer is a different account, before funds move.
     */
    payer?: string;
}>;
/** Hook called immediately before a protocol client creates a credential. */
export type BeforePayment<context = never> = (requirement: PaymentRequirement, context: PaymentContext) => Promise<PaymentPreparation<context> | undefined>;
/** A payment client bound to machine-fetch's pre-payment hook. */
export type BoundPaymentClient = Readonly<{
    /** Protocol-aware transport; pass `context` to every hook call made for this request. */
    fetch(input: RequestInfo | URL, init: RequestInit | undefined, context: PaymentContext): Promise<Response>;
    /** Unwrapped transport that bypasses payment handling and local policy. */
    raw: typeof globalThis.fetch;
    /** Release adapter state; afterwards `fetch` must reject without creating credentials. */
    dispose?(): void;
}>;
/**
 * Adapter implemented by an MPP, x402, or future payment client. `context` is the credential
 * context type the client accepts from funders; `never` means funders cannot provide one.
 */
export type PaymentClient<context = never> = Readonly<{
    /**
     * Bind the pre-payment hook. Hook rejection must stop signing and propagate to the caller.
     * Declared as a property so the credential context type is checked strictly.
     */
    bind: (options: Readonly<{
        beforePayment: BeforePayment<context>;
    }>) => BoundPaymentClient;
}>;
/** Lifecycle event emitted for observability; `attemptId` correlates events of one Fetch call. */
export type MachineFetchEvent = Readonly<{
    attemptId: string;
    requirement: PaymentRequirement;
}> & (Readonly<{
    type: 'payment.challenge';
}> | Readonly<{
    type: 'funding.complete';
    funder: string;
    receipt: FundingReceipt;
}> | Readonly<{
    type: 'payment.ready';
}> | Readonly<{
    type: 'payment.failed';
    error: Error;
}>);
/** Options accepted by {@link machineFetch}. */
export type MachineFetchOptions<context = never> = Readonly<{
    /** Protocol adapter responsible for negotiation, signing, and paid retries. */
    client: PaymentClient<context>;
    /** Ordered funders; only the first match prepares funds. Defaults to none. */
    funders?: readonly Funder<context>[] | undefined;
    /** Local limits applied before funding and signing; maxPayment is unset by default. */
    policy?: PaymentPolicy | undefined;
    /** Observer called without blocking payment; failures are ignored. Do not log sensitive metadata. */
    onEvent?: ((event: MachineFetchEvent) => MaybePromise<void>) | undefined;
}>;
/** A Fetch-compatible function with an unwrapped escape hatch. */
export type MachineFetch = {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /**
     * A Fetch function whose payments use a caller-chosen attempt ID. Persist the ID before calling
     * so funding interrupted by a crash can be recovered; use one ID per paid request.
     */
    withAttempt(attemptId: string): typeof globalThis.fetch;
    /** Unwrapped Fetch transport; explicitly bypasses payment handling and policy. */
    readonly raw: typeof globalThis.fetch;
    /** Release adapter state after all requests finish; later calls reject. */
    dispose(): void;
};
//# sourceMappingURL=payment.d.ts.map