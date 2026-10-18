import { PaymentPolicyError } from '../core/errors.js';
import { isEvmNetwork } from '../core/validate.js';
/** Converts a selected x402 requirement to the common model, identically for every adapter. */
export function x402PaymentRequirement(selection, resource, x402Version) {
    return {
        protocol: 'x402',
        method: selection.scheme,
        intent: 'charge',
        network: parseNetwork(selection.network),
        asset: selection.asset,
        amount: parseAtomicAmount(selection.amount),
        recipient: selection.payTo,
        resource,
        metadata: { extra: selection.extra, x402Version },
    };
}
/**
 * Parses a challenged amount in atomic units. Mppx and x402 schemas type amounts as strings; only
 * the canonical decimal spelling is accepted, so one amount cannot be written two ways.
 */
export function parseAtomicAmount(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))
        throw invalidPayment('Payment amount must be a canonical non-negative integer string');
    return BigInt(value);
}
/** Returns a challenged network, rejecting EVM networks whose chain ID is not canonical. */
export function parseNetwork(network) {
    if (network.startsWith('eip155:') && !isEvmNetwork(network))
        throw invalidPayment('Payment network must be a canonical eip155:<chainId>');
    return network;
}
/** A malformed or unsupported server challenge. */
export function invalidPayment(message, cause) {
    return new PaymentPolicyError(message, { cause, code: 'INVALID_PAYMENT' });
}
//# sourceMappingURL=shared.js.map