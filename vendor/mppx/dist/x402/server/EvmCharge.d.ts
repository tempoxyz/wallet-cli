import type * as Credential from '../../Credential.js';
import * as Types from '../../evm/Types.js';
import * as ServerTransport from '../../server/Transport.js';
import * as x402_Types from '../Types.js';
export type Options = {
    /** Facilitator client or base URL used for x402-compatible settlement. */
    facilitator?: string | x402_Types.Facilitator | undefined;
    /** Fetch implementation used for facilitator RPCs. */
    fetch?: typeof globalThis.fetch | undefined;
    /** Maximum time in seconds allowed for x402-compatible payment completion. @default 300 */
    maxTimeoutSeconds?: number | undefined;
    /**
     * How a route-scoped charge binds an x402 credential to its route.
     *
     * - `'resource'` — accept either binding. A credential carrying
     *   `extensions.mppx` is verified in full, including the route-bound nonce; one
     *   without it is bound the way x402 itself binds, by comparing the echoed
     *   `resource` and `accepted`. Any spec-compliant client can pay a scoped route.
     * - `'required'` — every credential must carry `extensions.mppx` and the
     *   route-bound nonce. Only clients that implement mppx's binding can pay.
     *
     * `'resource'` is weaker for clients that don't bind: `resource` sits outside
     * the EIP-3009 signature, so a holder of a valid payload could re-present it at
     * another route with identical `accepted`. It prevents honest cross-route reuse
     * and client bugs, not an active attacker. Body binding is unaffected either
     * way — `challenge.digest` is verified against the actual body.
     *
     * @default 'resource'
     */
    routeBinding?: RouteBindingMode | undefined;
};
/** How a route-scoped charge binds an x402 credential to its route. */
export type RouteBindingMode = 'required' | 'resource';
export type ResolvedOptions = {
    authorization: Types.AuthorizationConfig;
    facilitator?: x402_Types.Facilitator | undefined;
    maxTimeoutSeconds: number;
    routeBinding: RouteBindingMode;
};
export type Path = {
    bindCredential: NonNullable<ServerTransport.Http['bindCredential']>;
    getCredential: ServerTransport.Http['getCredential'];
    respondChallenge: (options: Parameters<ServerTransport.Http['respondChallenge']>[0], response?: Response | undefined) => Response | Promise<Response>;
    respondReceipt: (options: Parameters<ServerTransport.Http['respondReceipt']>[0], response: Response) => Response;
};
/** Resolves optional x402 compatibility options for an EVM charge. */
export declare function resolveOptions(parameters: {
    authorization: Types.AuthorizationConfig;
    options?: Options | undefined;
}): ResolvedOptions;
/** Creates the x402 wire path for an EVM charge method. */
export declare function createPath(config: ResolvedOptions): Path;
/** Settles a verified EVM authorization through an x402 facilitator. */
export declare function settleWithFacilitator(parameters: ResolvedOptions): SettleWithFacilitator;
/** Checks an EVM authorization with the facilitator without settling it. */
export declare function verifyWithFacilitator(parameters: ResolvedOptions, authorization: Parameters<SettleWithFacilitator>[0]): Promise<void>;
export type SettleWithFacilitator = (parameters: {
    credential: Credential.Credential<Types.AuthorizationPayload>;
    payload: Types.AuthorizationPayload;
    request: Types.ChargeRequest;
    source: ReturnType<typeof Types.toSource>;
}) => Promise<{
    reference: string;
    timestamp?: string | undefined;
}>;
/** Returns whether a credential was converted from an x402 payment payload. */
export declare function isCredential(credential: Credential.Credential): boolean;
/** Returns whether a credential was parsed from the x402 payment header. */
export declare function isPendingCredential(credential: Credential.Credential): boolean;
/** Converts a native EVM charge request to x402 exact payment requirements. */
export declare function toPaymentRequirements(request: Types.ChargeRequest, config: Pick<ResolvedOptions, 'authorization' | 'maxTimeoutSeconds'>): x402_Types.PaymentRequirements;
/** Converts an x402 EIP-3009 payment payload to the native EVM authorization payload. */
export declare function payloadToAuthorization(paymentPayload: x402_Types.PaymentPayload): Types.AuthorizationPayload;
//# sourceMappingURL=EvmCharge.d.ts.map