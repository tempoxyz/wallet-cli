import { Bytes, Hash } from 'ox';
import * as PaymentRequest from '../../PaymentRequest.js';
/** Computes the route-bound EIP-3009 nonce for an x402 exact payment. */
export function nonce(parameters) {
    const input = [
        PaymentRequest.serialize(parameters.accepted),
        PaymentRequest.serialize(parameters.resource),
        PaymentRequest.serialize(parameters.extensions),
    ].join('|');
    return Hash.sha256(Bytes.fromString(input), { as: 'Hex' });
}
//# sourceMappingURL=RouteBinding.js.map