import type { PaymentCreationContext, x402Client } from '@x402/core/client';
import type { MachineFetch, MachineFetchOptions, PaymentClient, PaymentRequirement } from '../interfaces/payment.js';
/** Options for adapting an existing official x402 client. */
export type FromX402Options = Readonly<{
    /** Unwrapped transport used for both the initial request and paid retry. @default globalThis.fetch */
    fetch?: typeof globalThis.fetch | undefined;
}>;
/** Core machine-fetch options for the x402 convenience wrapper; funders cannot return context. */
export type X402FetchOptions = Omit<MachineFetchOptions, 'client'> & FromX402Options;
/** Wraps an existing official x402 client as a paid Fetch function. */
export declare function x402Fetch(client: x402Client, options?: X402FetchOptions): MachineFetch;
/**
 * Adapts an existing official x402 client and preserves all registered schemes and policies.
 * While bound, the client creates payments only through the bound fetch; other credential creation
 * on it is rejected. After `dispose`, the binding's fetch rejects and the client may be rebound.
 */
export declare function fromX402(client: x402Client, options?: FromX402Options): PaymentClient<never>;
/** Converts an official x402 selection to the common payment model. */
export declare function x402Requirement(context: PaymentCreationContext): PaymentRequirement;
