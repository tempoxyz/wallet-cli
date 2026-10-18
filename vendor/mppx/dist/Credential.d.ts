import * as Challenge from './Challenge.js';
/**
 * A payment credential containing the challenge and payment proof.
 */
export type Credential<payload = unknown, challenge extends Challenge.Challenge = Challenge.Challenge> = {
    /** The challenge from the 402 response. */
    challenge: challenge;
    /** Method-specific payment proof. */
    payload: payload;
    /** Optional payer identifier as a DID (e.g., "did:pkh:eip155:1:0x..."). */
    source?: string;
};
export declare class MissingAuthorizationHeaderError extends Error {
    readonly name = "MissingAuthorizationHeaderError";
    constructor(header?: string);
}
export declare class MissingPaymentSchemeError extends Error {
    readonly name = "MissingPaymentSchemeError";
    constructor();
}
export declare class InvalidCredentialEncodingError extends Error {
    readonly name = "InvalidCredentialEncodingError";
    constructor();
}
/**
 * Deserializes a Payment credential header value to a credential.
 * Accepts the spec-compliant base64url `opaque` string shape and the legacy
 * object-shaped `opaque` form emitted by older mppx versions.
 *
 * @param header - The Authorization header value.
 * @returns The deserialized credential.
 *
 * @example
 * ```ts
 * import { Credential } from 'mppx'
 *
 * const credential = Credential.deserialize(header)
 * ```
 */
export declare function deserialize<payload = unknown>(value: string): Credential<payload>;
/**
 * Creates a credential from the given parameters.
 *
 * @param parameters - Credential parameters with a Challenge object.
 * @returns A credential.
 *
 * @example
 * ```ts
 * import { Credential, Challenge } from 'mppx'
 *
 * const credential = Credential.from({
 *   challenge,
 *   payload: { signature: '0x...' },
 * })
 * ```
 */
export declare function from<const parameters extends from.Parameters>(parameters: parameters): Credential<parameters['payload'], parameters['challenge']>;
export declare namespace from {
    type Parameters = {
        /** The challenge from the 402 response. */
        challenge: Challenge.Challenge;
        /** Method-specific payment proof. */
        payload: unknown;
        /** Optional payer identifier as a DID (e.g., "did:pkh:eip155:1:0x..."). */
        source?: string;
    };
}
/**
 * Extracts the credential from a Request's configured credential header.
 *
 * @param request - The HTTP request.
 * @returns The deserialized credential.
 *
 * @example
 * ```ts
 * import { Credential } from 'mppx'
 *
 * const credential = Credential.fromRequest(request)
 * ```
 */
export declare function fromRequest<payload = unknown>(request: Request, options?: fromRequest.Options): Credential<payload>;
export declare namespace fromRequest {
    type Options = {
        /** HTTP field containing the Payment credential. @default 'Authorization' */
        header?: string | undefined;
    };
}
/**
 * Serializes a credential to the Payment credential header format.
 * When present, `challenge.opaque` is emitted unchanged as the base64url string
 * required by the Payment auth credential format.
 *
 * @param credential - The credential to serialize.
 * @returns A string suitable for the Authorization header value.
 *
 * @example
 * ```ts
 * import { Credential } from 'mppx'
 *
 * const header = Credential.serialize(credential)
 * // => 'Payment eyJjaGFsbGVuZ2UiOnsi...'
 * ```
 */
export declare function serialize(credential: Credential): string;
/**
 * Extracts the `Payment` scheme from an Authorization header value
 * that may contain multiple schemes (comma-separated per RFC 9110).
 *
 * @param header - The raw Authorization header value.
 * @returns The `Payment ...` scheme string, or `null` if not found.
 */
export declare function extractPaymentScheme(header: string): string | null;
//# sourceMappingURL=Credential.d.ts.map