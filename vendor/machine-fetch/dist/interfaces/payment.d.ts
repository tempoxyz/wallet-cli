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
    recipient?: string | undefined;
    /** Resource selected by the protocol client; funders must preserve it. */
    resource?: string | undefined;
    /** Reference currency used for display-value limits and same-currency funding. */
    currency?: string | undefined;
    /** Number of atomic decimal places, an integer from 0 to 255, used for display-value limits. */
    decimals?: number | undefined;
    /**
     * Set when the payment client may itself spend assets other than `asset` to pay, in amounts it
     * cannot bound before signing, such as Mppx's Tempo machine-token route. Every `maxFundingSpend`
     * policy rejects such a payment, whichever funder matches; funders must preserve it.
     */
    unboundedFunding?: boolean | undefined;
    /** Protocol data may be untrusted. Never include credentials, signatures, or private keys. */
    metadata?: Readonly<Record<string, unknown>> | undefined;
}>;
/** Identity and cancellation of one paid Fetch call, shared by every hook and funder it reaches. */
export type PaymentContext = Readonly<{
    /**
     * Correlates events and funding work for one Fetch call. Random unless the caller passes
     * `operationId` in the request init; supply and persist it to recover funding after a crash.
     */
    operationId: string;
    /** Request cancellation; abort does not prove that funds have not moved. */
    signal: AbortSignal;
    /**
     * Account that will sign the payment credential, when the host knows it. Funders that deliver
     * funds to an account reject a payment whose payer is a different account, before funds move.
     */
    payer?: string | undefined;
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
    dispose?: (() => void) | undefined;
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
    /**
     * Funders the client supplies for payments it knows how to fund, tried after the configured
     * ones. The Mppx client supplies Tempo auto-swap.
     * @default []
     */
    funders?: readonly Funder<context>[] | undefined;
}>;
/** Payload of every lifecycle callback; `operationId` correlates the callbacks of one Fetch call. */
export type PaymentEvent = Readonly<{
    operationId: string;
    requirement: PaymentRequirement;
}>;
/** Payload of `onFundingComplete`: the funder that ran and its receipt. */
export type FundingCompleteEvent = PaymentEvent & Readonly<{
    funder: string;
    receipt: FundingReceipt;
}>;
/** Payload of `onPaymentFailed`: the error that stopped the payment. */
export type PaymentFailedEvent = PaymentEvent & Readonly<{
    error: Error;
}>;
/**
 * Lifecycle observers. Each runs beside the payment without blocking it, and thrown errors are
 * ignored. Do not log sensitive metadata.
 */
export type PaymentObservers = Readonly<{
    /** Called when a request receives a payment challenge. */
    onPaymentRequired?: ((event: PaymentEvent) => void | Promise<void>) | undefined;
    /** Called after a funder acquired or confirmed the payment asset. */
    onFundingComplete?: ((event: FundingCompleteEvent) => void | Promise<void>) | undefined;
    /** Called when the payment passed policy and funding, just before the credential is signed. */
    onPaymentReady?: ((event: PaymentEvent) => void | Promise<void>) | undefined;
    /** Called when policy, funding, or preparation rejected the payment. */
    onPaymentFailed?: ((event: PaymentFailedEvent) => void | Promise<void>) | undefined;
}>;
/** Options accepted by {@link machineFetch}: the client, funders, payer, local policy, and observers. */
export type MachineFetchOptions<context = never> = Readonly<{
    /** Protocol adapter responsible for negotiation, signing, and paid retries. */
    client: PaymentClient<context>;
    /** Ordered funders; only the first match prepares funds. @default [] */
    funders?: readonly Funder<context>[] | undefined;
    /**
     * Account that signs this wrapper's payment credentials, such as the x402 signer address. Every
     * request carries it in `PaymentContext`, so funders that deliver funds to an account reject a
     * payment they would fund for a different one. Unset, funders cannot check the payer.
     */
    payer?: string | undefined;
}> & PaymentPolicy & PaymentObservers;
/** Fetch's `RequestInit` plus the paid request's identity, as Mppx adds `context`. */
export type MachineFetchRequestInit = globalThis.RequestInit & {
    /**
     * Caller-chosen operation ID for this request's payment and funding work, never sent upstream.
     * Persist it before calling so funding interrupted by a crash can be recovered; use one ID per
     * paid request.
     * @default crypto.randomUUID()
     */
    operationId?: string | undefined;
};
/** A Fetch-compatible function with an unwrapped escape hatch. */
export type MachineFetch = {
    (input: RequestInfo | URL, init?: MachineFetchRequestInit): Promise<Response>;
    /** Unwrapped Fetch transport; explicitly bypasses payment handling and policy. */
    readonly raw: typeof globalThis.fetch;
    /** Release adapter state after all requests finish; later calls reject. */
    dispose(): void;
};
