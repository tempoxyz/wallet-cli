import type { MachineFetch, MachineFetchOptions, PaymentClient } from '../interfaces/payment.js';
/** Creates a paid Fetch function from any protocol client; `client` overrides `options.client`. */
export declare function machineFetchFrom<context = never>(client: PaymentClient<context>, options?: Omit<MachineFetchOptions<context>, 'client'>): MachineFetch;
/** Creates a Fetch-compatible client that prepares funds before payment signing. */
export declare function machineFetch<context = never>(options: MachineFetchOptions<context>): MachineFetch;
/** The abort signal governing a Fetch call; an explicit `init.signal: null` opts out. */
export declare function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal;
