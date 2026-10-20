/**
 * Paid Fetch for an existing official x402 client. Mppx also pays x402 challenges; use this only
 * when your app already configures `@x402/fetch`.
 * @module
 */
import type { PaymentCreationContext, x402Client } from '@x402/core/client';
import { type FromX402Options, type X402FetchOptions } from '../adapters/x402.js';
import type { MachineFetch, PaymentClient, PaymentRequirement } from '../interfaces/payment.js';
import type * as Errors from './Errors.js';
/**
 * Wraps a configured x402 client, keeping its registered schemes and hooks.
 *
 * @example
 * ```ts
 * import { X402Fetch } from 'machine-fetch/x402'
 *
 * const fetchPaid = X402Fetch.from(x402, { maxPayment })
 * ```
 */
export declare const from: (client: x402Client, options?: from.Options) => MachineFetch;
export declare namespace from {
    /** Options for {@link from}: machine-fetch's options plus the transport for paid requests. */
    type Options = X402FetchOptions;
    /** Errors {@link from} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/** Exposes a configured x402 client as a payment client for `MachineFetch.from`. */
export declare const client: (client: x402Client, options?: client.Options) => PaymentClient<never>;
export declare namespace client {
    /** Transport options for {@link client}. */
    type Options = FromX402Options;
}
/** Normalizes an x402 payment context into the requirement policy and funders evaluate. */
export declare const requirement: (context: PaymentCreationContext) => PaymentRequirement;
