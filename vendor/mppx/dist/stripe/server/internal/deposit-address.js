import { stripeRequest } from './request.js';
const cache = new WeakMap();
/**
 * Finds an existing deposit address or creates a new one for the given network.
 * Cached per client+network+stripeAccount for the process lifetime.
 */
export async function findOrCreateDepositAddress(client, network, options) {
    let clientCache = cache.get(client);
    if (!clientCache) {
        clientCache = new Map();
        cache.set(client, clientCache);
    }
    const key = options?.connect?.stripeAccount
        ? `${options.connect.stripeAccount}:${network}`
        : network;
    const cached = clientCache.get(key);
    if (cached)
        return cached;
    const list = (await stripeRequest(client, 'GET', `/v1/crypto/deposit_addresses?network=${network}&limit=1`, undefined, options));
    if (list.data && list.data.length > 0) {
        clientCache.set(key, list.data[0].address);
        return list.data[0].address;
    }
    const created = (await stripeRequest(client, 'POST', '/v1/crypto/deposit_addresses', { network }, options));
    clientCache.set(key, created.address);
    return created.address;
}
//# sourceMappingURL=deposit-address.js.map