import type { BareItem } from 'structured-headers';
import type { MaybePromise } from '../../internal/types.js';
import * as Store from '../../Store.js';
import type { KeyResolver, SignatureAlgorithm, SigningContext } from '../Types.js';
/** RFC 9421 constants used by request-attestation signature profiles. */
export declare const Constants: {
    /** Derived request components supported by this narrow request profile. */
    readonly components: {
        /** The target host and non-default port. */
        readonly authority: '@authority';
        /** The request URL path without its query string. */
        readonly path: '@path';
        /** The lowercased `Signature-Agent` request header. */
        readonly signatureAgent: 'signature-agent';
        /** The signature's canonicalized covered-components and parameters. */
        readonly signatureParams: '@signature-params';
    };
};
/** A covered HTTP message component and its RFC 9421 component parameters. */
export type Component = {
    /** Derived component identifier or lowercased HTTP field name. */
    id: string;
    /** Parameters that qualify the component, such as `;key="agent"`. */
    parameters?: ReadonlyMap<string, BareItem> | undefined;
};
/** Input accepted by signers; bare strings denote unparameterized components. */
export type ComponentInput = string | Component;
export type SignatureInput = {
    algorithm: SignatureAlgorithm;
    components: readonly Component[];
    created: number;
    expires: number;
    keyId: string;
    label: string;
    nonce: string;
    parameters: ReadonlyMap<string, BareItem>;
    tag: string;
};
/** Result of validating one supported RFC 9421 signature. */
export type VerificationResult = {
    status: 'absent';
} | {
    status: 'invalid';
    reason: string;
} | {
    status: 'unverified';
    reason: string;
} | {
    status: 'verified';
    input: SignatureInput;
};
/** Signs a request using the configured RFC 9421-derived component list. */
export declare function sign(request: Request, options: {
    components: readonly ComponentInput[];
    expiresIn?: number | undefined;
    keyId: string;
    key: CryptoKey;
    label: string;
    context?: SigningContext | undefined;
    tag: string;
}): Promise<Request>;
/** Verifies a request signature, its lifetime, and optionally its nonce. */
export declare function verify(request: Request, options: {
    keyResolver: KeyResolver;
    maxAge: number;
    nonceNamespace: string;
    nonceStore: Store.AtomicStore;
    requiredComponents: readonly string[];
    tag: string | readonly string[];
    validate?: ((input: SignatureInput, request: Request) => string | undefined) | undefined;
    validateKey?: ((key: CryptoKey, input: SignatureInput, request: Request) => MaybePromise<string | undefined>) | undefined;
}): Promise<VerificationResult>;
//# sourceMappingURL=HttpMessageSignature.d.ts.map