import type * as Types from '../Types.js';
/** Computes the route-bound EIP-3009 nonce for an x402 exact payment. */
export declare function nonce(parameters: {
    accepted: Types.PaymentRequirements;
    extensions: Types.Extensions;
    resource: Types.ResourceInfo;
}): `0x${string}`;
//# sourceMappingURL=RouteBinding.d.ts.map