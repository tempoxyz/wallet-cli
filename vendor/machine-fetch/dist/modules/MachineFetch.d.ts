/**
 * The paid Fetch function. `create` pays MPP and x402 challenges through Mppx; `from` wraps any
 * other protocol client.
 * @module
 */
import type { Mppx, Transport } from 'mppx/client';
import { type MppxFetchOptions } from '../adapters/mppx.js';
import type { MachineFetch, MachineFetchOptions, PaymentClient } from '../interfaces/payment.js';
import type * as Errors from './Errors.js';
export type { DisposedErrorType } from '../core/errors.js';
export { DisposedError } from '../core/errors.js';
export type { TempoAutoSwap as AutoSwap } from '../funders/tempo.js';
export type { FundingCompleteEvent, MachineFetch, MachineFetchRequestInit as RequestInit, PaymentEvent, PaymentFailedEvent, PaymentObservers as Observers, } from '../interfaces/payment.js';
/**
 * Creates a paid Fetch function from Mppx methods plus machine-fetch funders and policy. Mppx pays
 * both MPP and x402 challenges: add the `evm` method for x402 offers on EVM chains. Tempo payments
 * in pathUSD or USDC swap from the other atomically when the wallet lacks the requested token; see
 * `autoSwap`.
 *
 * @example
 * ```ts
 * import { MachineFetch } from 'machine-fetch'
 * import { evm, tempo } from 'mppx/client'
 *
 * const fetchPaid = MachineFetch.create({
 *   methods: [tempo({ account }), evm({ account })],
 *   maxPayment: { amount: '0.25', currency: 'USD' },
 * })
 * const response = await fetchPaid('https://api.example.com/data')
 * ```
 */
export declare const create: <const methods extends Mppx.Methods, const transport extends Transport.AnyTransport = Transport.Transport>(options: create.Options<methods, transport>) => MachineFetch;
export declare namespace create {
    /** Options for {@link create}: Mppx's own options, minus `onChallenge` and `polyfill`, plus machine-fetch's. */
    type Options<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = MppxFetchOptions<methods, transport>;
    /** Errors {@link create} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/**
 * Creates a paid Fetch function from any protocol client, such as an existing Mppx client
 * (`MppxFetch.client`) or a custom one.
 *
 * @example
 * ```ts
 * const fetchPaid = MachineFetch.from(MppxFetch.client(mppx), { funders, maxPayment })
 * ```
 */
export declare const from: <context = never>(client: PaymentClient<context>, options?: from.Options<context>) => MachineFetch;
export declare namespace from {
    /** Options for {@link from}: funders, policy, payer, and lifecycle callbacks. */
    type Options<context = never> = Omit<MachineFetchOptions<context>, 'client'>;
    /** Errors {@link from} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/**
 * Errors a paid request can reject with: any machine-fetch error, or an upstream error from Fetch,
 * the protocol client, or a funder.
 */
export type ErrorType = Errors.ErrorType | Errors.GlobalErrorType;
