import { fromX402, x402Fetch, x402Requirement, } from '../adapters/x402.js';
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
export const from = x402Fetch;
/** Exposes a configured x402 client as a payment client for `MachineFetch.from`. */
export const client = fromX402;
/** Normalizes an x402 payment context into the requirement policy and funders evaluate. */
export const requirement = x402Requirement;
