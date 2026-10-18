import * as Assets from '../Assets.js';
import * as Chains from '../Chains.js';
import { charge as charge_ } from './Charge.js';
/**
 * Creates ordered EVM charge offers from shared parameters.
 *
 * Pass `currencies: [token]` for one asset or an ordered list for multiple assets.
 * Viem token definitions resolve against `chainId`; known assets carry their own
 * network. Unsupported chain entries are skipped and duplicate chain/address
 * pairs are removed. An empty resolved list throws.
 *
 * Token definitions need explicit EIP-3009 domain metadata. Use
 * `evm.assets.fromToken(token, { chainId, transfer })` for per-token domains.
 * A token registry entry alone does not establish EIP-3009 support.
 *
 * @example
 * ```ts
 * import { evm } from 'mppx/server'
 *
 * evm({
 *   currencies: [evm.assets.base.USDC],
 *   recipient: '0x742d35Cc6634c0532925a3b844bC9e7595F8fE00',
 *   settle: async ({ payload }) => settleAuthorization(payload),
 * })
 * ```
 */
export function evm(parameters) {
    if (parameters.currency !== undefined) {
        if (parameters.currencies !== undefined)
            throw new Error('Specify either `currency` or `currencies`, not both.');
        return [evm.charge(parameters)];
    }
    const { currencies, ...shared } = parameters;
    const seen = new Set();
    const methods = [];
    for (const currency of currencies) {
        const chainId = shared.chainId ?? (Assets.isAsset(currency) ? Assets.toChainId(currency.network) : undefined);
        if (chainId === undefined)
            throw new Error('EVM currencies require `chainId` or known asset metadata.');
        const resolved = Assets.resolve(currency, Assets.toNetwork(chainId));
        if (!resolved)
            continue;
        // One shared price cannot price non-USD or unknown-denomination token definitions.
        if (Assets.isToken(currency) && currency.currency !== 'USD')
            continue;
        const key = `${chainId}:${resolved.address.toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        methods.push(evm.charge({ ...shared, chainId, currency }));
    }
    if (methods.length === 0)
        throw new Error('No accepted EVM currencies for the configured chain.');
    return methods;
}
(function (evm) {
    /** Creates an EVM `charge` server method. */
    evm.charge = charge_;
    /** Known EVM asset metadata for public config. */
    evm.assets = Assets;
    /** Common EVM chain IDs for public config. */
    evm.chains = Chains;
})(evm || (evm = {}));
//# sourceMappingURL=Methods.js.map