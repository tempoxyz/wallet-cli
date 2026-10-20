import { mppxFetch } from '../adapters/mppx.js';
import { machineFetchFrom } from '../core/machine-fetch.js';
export { DisposedError } from '../core/errors.js';
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
export const create = mppxFetch;
/**
 * Creates a paid Fetch function from any protocol client, such as an existing Mppx client
 * (`MppxFetch.client`) or a custom one.
 *
 * @example
 * ```ts
 * const fetchPaid = MachineFetch.from(MppxFetch.client(mppx), { funders, maxPayment })
 * ```
 */
export const from = machineFetchFrom;
