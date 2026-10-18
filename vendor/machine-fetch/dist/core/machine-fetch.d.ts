import type { MachineFetch, MachineFetchOptions } from '../interfaces/payment.js';
/** Creates a Fetch-compatible client that prepares funds before payment signing. */
export declare function machineFetch<context = never>(options: MachineFetchOptions<context>): MachineFetch;
/** The abort signal governing a Fetch call; an explicit `init.signal: null` opts out. */
export declare function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal;
//# sourceMappingURL=machine-fetch.d.ts.map