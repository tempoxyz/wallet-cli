import { Base64 } from 'ox';
import * as Challenge from './Challenge.js';
import * as Constants from './Constants.js';
import * as PaymentRequest from './PaymentRequest.js';
export class MissingAuthorizationHeaderError extends Error {
    name = 'MissingAuthorizationHeaderError';
    constructor(header = Constants.Headers.authorization) {
        super(`Missing ${header} header.`);
    }
}
export class MissingPaymentSchemeError extends Error {
    name = 'MissingPaymentSchemeError';
    constructor() {
        super('Missing Payment scheme.');
    }
}
export class InvalidCredentialEncodingError extends Error {
    name = 'InvalidCredentialEncodingError';
    constructor() {
        super('Invalid base64url or JSON.');
    }
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
export function deserialize(value) {
    const prefixMatch = value.match(new RegExp(`^${Constants.Schemes.payment}\\s+(.+)$`, 'i'));
    if (!prefixMatch?.[1])
        throw new MissingPaymentSchemeError();
    try {
        const json = Base64.toString(prefixMatch[1]);
        const parsed = JSON.parse(json);
        const { opaque: challengeOpaque, request, meta: _meta, ...challengeFields } = parsed.challenge;
        const { meta, opaque } = normalizeCredentialOpaque(challengeOpaque);
        const challenge = Challenge.Schema.parse({
            ...challengeFields,
            ...(meta !== undefined && { meta }),
            ...(opaque !== undefined && { opaque }),
            request: PaymentRequest.deserialize(request),
        });
        return {
            challenge,
            payload: parsed.payload,
            ...(parsed.source && { source: parsed.source }),
        };
    }
    catch {
        throw new InvalidCredentialEncodingError();
    }
}
function normalizeCredentialOpaque(value) {
    if (value === undefined)
        return {};
    if (typeof value === 'string')
        return { opaque: value };
    if (!isStringRecord(value))
        throw new Error('Invalid opaque.');
    // Older mppx clients emitted credential challenge `opaque` as an expanded
    // object. Keep accepting that legacy shape, but normalize it back to the
    // spec-required base64url string.
    return {
        meta: value,
        opaque: PaymentRequest.serialize(value),
    };
}
function isStringRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    return Object.values(value).every((entry) => typeof entry === 'string');
}
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
export function from(parameters) {
    const { challenge, payload, source } = parameters;
    return {
        challenge,
        payload,
        ...(source && { source }),
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
export function fromRequest(request, options = {}) {
    const header = request.headers.get(options.header ?? Constants.Headers.authorization);
    if (!header)
        throw new MissingAuthorizationHeaderError(options.header);
    const payment = extractPaymentScheme(header);
    if (!payment)
        throw new MissingPaymentSchemeError();
    return deserialize(payment);
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
export function serialize(credential) {
    const { meta, opaque, request, ...challenge } = credential.challenge;
    const wireOpaque = opaque ?? (meta !== undefined ? PaymentRequest.serialize(meta) : undefined);
    const wire = {
        challenge: {
            ...challenge,
            ...(wireOpaque !== undefined && { opaque: wireOpaque }),
            request: PaymentRequest.serialize(request),
        },
        payload: credential.payload,
        ...(credential.source && { source: credential.source }),
    };
    const json = JSON.stringify(wire);
    const encoded = Base64.fromString(json, { pad: false, url: true });
    return `${Constants.Schemes.payment} ${encoded}`;
}
/**
 * Extracts the `Payment` scheme from an Authorization header value
 * that may contain multiple schemes (comma-separated per RFC 9110).
 *
 * @param header - The raw Authorization header value.
 * @returns The `Payment ...` scheme string, or `null` if not found.
 */
export function extractPaymentScheme(header) {
    const schemes = header.split(',').map((s) => s.trim());
    return schemes.find((s) => new RegExp(`^${Constants.Schemes.payment}\\s+`, 'i').test(s)) ?? null;
}
//# sourceMappingURL=Credential.js.map