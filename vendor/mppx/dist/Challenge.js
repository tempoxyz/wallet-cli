import { Base64, Bytes, Hash } from 'ox';
import * as Constants from './Constants.js';
import { constantTimeEqual } from './internal/constantTimeEqual.js';
import * as PaymentRequest from './PaymentRequest.js';
import * as z from './zod.js';
const maxRequestParameterLength = 16 * 1024;
/**
 * Schema for a payment challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const challenge = Challenge.Schema.parse(data)
 * ```
 */
export const Schema = z.object({
    /** Optional human-readable description of the payment. */
    description: z.optional(z.string()),
    /** Optional digest of the request body (format: "sha-256=base64hash"). */
    digest: z.optional(z.string().check(z.regex(/^sha-256=/, 'Invalid digest format'))),
    /** Optional expiration timestamp (ISO 8601). */
    expires: z.optional(z.datetime()),
    /** Optional HTTP field name to carry the payment credential. When omitted, uses Authorization. */
    header: z.optional(z.string().check(z.regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Invalid HTTP header name'))),
    /** Unique challenge identifier (HMAC-bound). */
    id: z.string().check(z.minLength(1)),
    /** Intent type (e.g., "charge", "session"). */
    intent: z.string(),
    /** Payment method (e.g., "tempo", "stripe"). */
    method: z.string(),
    /** Optional parsed server-defined correlation data. */
    meta: z.optional(z.record(z.string(), z.string())),
    /** Optional server-defined correlation data. Raw base64url string; clients MUST NOT modify. */
    opaque: z.optional(z.string()),
    /** Server realm (e.g., hostname). */
    realm: z.string(),
    /** Method-specific request data. */
    request: z.record(z.string(), z.unknown()),
});
/**
 * Creates a challenge from the given parameters.
 *
 * If `secretKey` option is provided, the challenge ID is computed as HMAC-SHA256
 * over the canonical challenge ID input
 * (`realm|method|intent|request|expires|digest|opaque`),
 * cryptographically binding the ID to its contents.
 *
 * @param parameters - Challenge parameters.
 * @param options - Optional settings including secretKey for HMAC-bound ID.
 * @returns A challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * // With HMAC-bound ID (recommended for servers)
 * const challenge = Challenge.from(
 *   {
 *     realm: 'api.example.com',
 *     method: 'tempo',
 *     intent: 'charge',
 *     request: { amount: '1000000', currency: '0x...', recipient: '0x...' },
 *   },
 *   { secretKey: 'my-secret' },
 * )
 *
 * // With explicit ID
 * const challenge = Challenge.from({
 *   id: 'abc123',
 *   realm: 'api.example.com',
 *   method: 'tempo',
 *   intent: 'charge',
 *   request: { amount: '1000000', currency: '0x...', recipient: '0x...' },
 * })
 * ```
 */
export function from(parameters, options) {
    void options;
    const { description, digest, meta, method: methodName, header: suppliedHeader, intent, realm, request, secretKey, } = parameters;
    // `Authorization` is the implicit protocol default and is intentionally not
    // advertised on the wire. This preserves the legacy challenge binding and
    // lets servers opt into an alternate credential field explicitly.
    const header = isDefaultCredentialHeader(suppliedHeader) ? undefined : suppliedHeader;
    const expires = parameters.expires ? z.toDatetimeString(parameters.expires) : undefined;
    const opaque = parameters.opaque ?? (meta !== undefined ? PaymentRequest.serialize(meta) : undefined);
    const id = secretKey
        ? computeId({ ...parameters, expires, ...(meta !== undefined && { meta }), opaque }, { secretKey })
        : parameters.id;
    return Schema.parse({
        id,
        realm,
        method: methodName,
        intent,
        request,
        ...(description && { description }),
        ...(digest && { digest }),
        ...(expires && { expires }),
        ...(header !== undefined && { header }),
        ...(meta !== undefined && { meta }),
        ...(opaque !== undefined && { opaque }),
    });
}
/**
 * Creates a validated challenge from a method intent.
 *
 * If `secretKey` option is provided, the challenge ID is computed as HMAC-SHA256
 * over the canonical challenge ID input, cryptographically binding the ID to its contents.
 *
 * @param intent - The method intent to validate against.
 * @param parameters - Challenge parameters (realm, request, optional expires/digest, and id if no secretKey).
 * @param options - Optional settings including secretKey for HMAC-bound ID.
 * @returns A validated challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 * import { Methods } from 'mppx/tempo'
 *
 * // With HMAC-bound ID (recommended for servers)
 * const challenge = Challenge.fromMethod(
 *   Methods.charge,
 *   {
 *     realm: 'api.example.com',
 *     expires: '2025-01-06T12:00:00Z',
 *     request: {
 *       amount: '1000000',
 *       currency: '0x20c0000000000000000000000000000000000001',
 *       recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
 *     },
 *   },
 *   { secretKey: 'my-secret' },
 * )
 * ```
 */
export function fromMethod(method, parameters) {
    const { name: methodName, intent } = method;
    const { description, digest, expires, header, id, meta, realm, secretKey } = parameters;
    const request = PaymentRequest.fromMethod(method, parameters.request);
    return from({
        ...(id !== undefined ? { id } : { secretKey }),
        realm,
        method: methodName,
        intent: intent,
        request,
        description,
        digest,
        expires,
        header,
        meta,
    });
}
/**
 * Serializes a challenge to the WWW-Authenticate header format.
 *
 * @param challenge - The challenge to serialize.
 * @returns A string suitable for the WWW-Authenticate header value.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const header = Challenge.serialize(challenge)
 * // => 'Payment id="abc123", realm="api.example.com", method="tempo", intent="charge", request="eyJhbW91bnQiOi..."'
 * ```
 */
export function serialize(challenge) {
    const parts = [
        authParam('id', challenge.id),
        authParam('realm', challenge.realm),
        authParam('method', challenge.method),
        authParam('intent', challenge.intent),
        authParam('request', PaymentRequest.serialize(challenge.request)),
    ];
    if (challenge.description !== undefined)
        parts.push(authParam('description', challenge.description));
    if (challenge.digest !== undefined)
        parts.push(authParam('digest', challenge.digest));
    if (challenge.expires !== undefined)
        parts.push(authParam('expires', challenge.expires));
    const credentialHeader = challenge.header;
    if (credentialHeader !== undefined && !isDefaultCredentialHeader(credentialHeader))
        parts.push(authParam('header', credentialHeader));
    if (challenge.opaque !== undefined)
        parts.push(authParam('opaque', challenge.opaque));
    else if (challenge.meta !== undefined)
        parts.push(authParam('opaque', PaymentRequest.serialize(challenge.meta)));
    return `${Constants.Schemes.payment} ${parts.join(', ')}`;
}
/** @internal */
function authParam(name, value) {
    if (/[\r\n]/.test(value))
        throw new Error('Invalid quoted-string value.');
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        // Header values must be ByteStrings (code points ≤ 0xFF): escape anything
        // above Latin-1 (em dashes, smart quotes, emoji in descriptions) so the
        // serialized challenge is always a legal header value instead of crashing
        // Response construction.
        .replace(/[\u0100-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return `${name}="${escaped}"`;
}
/**
 * Deserializes a WWW-Authenticate header value to a challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const challenge = Challenge.deserialize(header)
 *
 * // With methods for type narrowing
 * const challenge = Challenge.deserialize(header, { methods })
 * ```
 *
 * @param header - The WWW-Authenticate header value.
 * @param options - Optional settings to narrow the challenge type.
 * @returns The deserialized challenge.
 */
export function deserialize(value, options) {
    const params = extractPaymentAuthParams(value);
    if (!params)
        throw new Error('Missing Payment scheme.');
    const result = parseAuthParams(params);
    const { request, opaque, ...rest } = result;
    if (!request)
        throw new Error('Missing request parameter.');
    if (request.length > maxRequestParameterLength)
        throw new Error('Request parameter too large.');
    if (rest.method && !/^[a-z][a-z0-9:_-]*$/.test(rest.method))
        throw new Error(`Invalid method: "${rest.method}". Must be lowercase per spec.`);
    return from({
        ...rest,
        request: PaymentRequest.deserialize(request),
        ...(opaque && { opaque }),
    }, options);
}
/** @internal Extracts the `Payment` scheme from a WWW-Authenticate value that may contain multiple schemes. */
function extractPaymentAuthParams(header) {
    const token = Constants.Schemes.payment;
    const [start] = findSchemeStarts(header, token);
    if (start === undefined)
        return null;
    let paramsStart = start + token.length;
    while (paramsStart < header.length && /\s/.test(header[paramsStart] ?? ''))
        paramsStart++;
    return header.slice(paramsStart);
}
/** @internal Parses auth-params with support for escaped quoted-string values. */
function parseAuthParams(input) {
    const result = Object.create(null);
    let i = 0;
    while (i < input.length) {
        while (i < input.length && /[\s,]/.test(input[i] ?? ''))
            i++;
        if (i >= input.length)
            break;
        const keyStart = i;
        while (i < input.length && /[A-Za-z0-9_-]/.test(input[i] ?? ''))
            i++;
        const key = input.slice(keyStart, i).toLowerCase();
        if (!key)
            throw new Error('Malformed auth-param.');
        while (i < input.length && /\s/.test(input[i] ?? ''))
            i++;
        // If there is no '=' after a token, this is likely another auth scheme.
        if (input[i] !== '=')
            break;
        i++;
        while (i < input.length && /\s/.test(input[i] ?? ''))
            i++;
        const [value, nextIndex] = readAuthParamValue(input, i);
        i = nextIndex;
        if (key in result)
            throw new Error(`Duplicate parameter: ${key}`);
        result[key] = value;
    }
    return result;
}
/** @internal */
function readAuthParamValue(input, start) {
    if (input[start] === '"')
        return readQuotedAuthParamValue(input, start + 1);
    let i = start;
    while (i < input.length && input[i] !== ',')
        i++;
    return [input.slice(start, i).trim(), i];
}
/** @internal */
function readQuotedAuthParamValue(input, start) {
    let i = start;
    let escaped = false;
    let segmentStart = start;
    let parts;
    while (i < input.length) {
        const char = input[i];
        i++;
        if (escaped) {
            parts ??= [];
            // `\\uXXXX` unescapes characters above Latin-1. Unambiguous: serializers
            // always double raw backslashes, so a bare `\\u` only ever comes from
            // the unicode escape in `authParam`.
            const hex = char === 'u' ? input.slice(i, i + 4) : undefined;
            if (hex && /^[0-9A-Fa-f]{4}$/.test(hex)) {
                parts.push(String.fromCharCode(Number.parseInt(hex, 16)));
                i += 4;
            }
            else
                parts.push(char);
            segmentStart = i;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            parts ??= [];
            parts.push(input.slice(segmentStart, i - 1));
            segmentStart = i;
            escaped = true;
            continue;
        }
        if (char === '"') {
            const value = parts
                ? [...parts, input.slice(segmentStart, i - 1)].join('')
                : input.slice(start, i - 1);
            return [value, i];
        }
    }
    throw new Error('Unterminated quoted-string.');
}
/** @internal */
function startsWithSchemeToken(value, index, token) {
    if (value.slice(index, index + token.length).toLowerCase() !== token.toLowerCase())
        return false;
    const next = value[index + token.length];
    return Boolean(next && /\s/.test(next));
}
/** @internal Finds auth scheme boundaries while ignoring quoted-string contents. */
function findSchemeStarts(value, token) {
    const starts = [];
    let inQuotes = false;
    let escaped = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (inQuotes) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inQuotes = false;
            continue;
        }
        if (char === '"') {
            inQuotes = true;
            continue;
        }
        if (!startsWithSchemeToken(value, i, token))
            continue;
        let boundary = i - 1;
        while (boundary >= 0 && /\s/.test(value[boundary] ?? ''))
            boundary--;
        if (boundary >= 0 && value[boundary] !== ',')
            continue;
        starts.push(i);
    }
    return starts;
}
/**
 * Extracts the challenge from a Headers object.
 *
 * @param headers - The HTTP headers.
 * @param options - Optional settings to narrow the challenge type.
 * @returns The deserialized challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const challenge = Challenge.fromHeaders(response.headers)
 *
 * // With methods for type narrowing
 * const challenge = Challenge.fromHeaders(response.headers, { methods })
 * ```
 */
export function fromHeaders(headers, options) {
    const header = headers.get(Constants.Headers.wwwAuthenticate);
    if (!header)
        throw new Error(`Missing ${Constants.Headers.wwwAuthenticate} header.`);
    return deserialize(header, options);
}
/**
 * Extracts the challenge from a Response's WWW-Authenticate header.
 *
 * @param response - The HTTP response (must be 402 status).
 * @param options - Optional settings to narrow the challenge type.
 * @returns The deserialized challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const response = await fetch('/resource')
 * if (response.status === 402)
 *   const challenge = Challenge.fromResponse(response)
 *
 * // With methods for type narrowing
 * const challenge = Challenge.fromResponse(response, { methods })
 * ```
 */
export function fromResponse(response, options) {
    if (response.status !== 402)
        throw new Error('Response status is not 402.');
    return fromHeaders(response.headers, options);
}
/**
 * Extracts all Payment challenges from a Response with potentially merged
 * `WWW-Authenticate` headers (multiple challenges in a single header value).
 *
 * @param response - The HTTP response (must be 402 status).
 * @param options - Optional settings to narrow the challenge type.
 * @returns An array of deserialized challenges.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const response = await fetch('/resource')
 * if (response.status === 402) {
 *   const challenges = Challenge.fromResponseList(response)
 *   // challenges[0] => tempo/charge, challenges[1] => stripe/charge
 * }
 * ```
 */
export function fromResponseList(response, options) {
    if (response.status !== 402)
        throw new Error('Response status is not 402.');
    return fromHeadersList(response.headers, options);
}
/**
 * Extracts all Payment challenges from a Headers object with potentially
 * merged `WWW-Authenticate` values.
 *
 * @param headers - The HTTP headers.
 * @param options - Optional settings to narrow the challenge type.
 * @returns An array of deserialized challenges.
 */
export function fromHeadersList(headers, options) {
    const header = headers.get(Constants.Headers.wwwAuthenticate);
    if (!header)
        throw new Error(`Missing ${Constants.Headers.wwwAuthenticate} header.`);
    return deserializeList(header, options);
}
/**
 * Deserializes a `WWW-Authenticate` header value that may contain multiple
 * Payment challenges (comma-separated per RFC 9110 §11.6.1).
 *
 * @param value - The raw WWW-Authenticate header value.
 * @param options - Optional settings to narrow the challenge type.
 * @returns An array of deserialized challenges.
 */
export function deserializeList(value, options) {
    const starts = findSchemeStarts(value, Constants.Schemes.payment);
    if (starts.length === 0)
        throw new Error('No Payment schemes found.');
    // Slice each scheme from its `Payment ` prefix up to the next scheme boundary,
    // trimming any trailing comma/whitespace between schemes.
    return starts.map((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : value.length;
        const chunk = value.slice(start, end).replace(/,\s*$/, '');
        return deserialize(chunk, options);
    });
}
/**
 * Verifies that a challenge ID matches the expected HMAC for the given parameters.
 *
 * @param challenge - The challenge to verify.
 * @param options - Options including the secret key.
 * @returns True if the challenge ID is valid, false otherwise.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const isValid = Challenge.verify(challenge, { secretKey: 'my-secret' })
 * ```
 */
export function verify(challenge, options) {
    const expectedId = computeId(challenge, options);
    return constantTimeEqual(challenge.id, expectedId);
}
/** Extracts parsed server-defined correlation data from a challenge when available. */
export function meta(challenge) {
    return challenge.meta;
}
/**
 * Canonical HMAC input for challenge ID binding per §5.1.2.1.1 of the spec.
 *
 * Seven fixed positional slots, pipe-delimited. Optional fields use empty
 * string when absent so the slot count is stable. This is the single source
 * of truth for what the challenge ID binds to — used by both `computeId()`
 * (challenge creation) and `verify()` (credential verification).
 *
 * Legacy slots: realm | method | intent | request | expires | digest | opaque.
 * Challenges advertising a credential header insert it immediately before the
 * final opaque slot.
 *
 * Because the HMAC covers ALL fields, the server does not need to separately
 * pin opaque, digest, or expires during verification — any change to those
 * fields produces a different HMAC and fails the ID comparison.
 */
function idBindingInput(challenge) {
    const values = [
        challenge.realm,
        challenge.method,
        challenge.intent,
        PaymentRequest.serialize(challenge.request),
        challenge.expires ?? '',
        challenge.digest ?? '',
    ];
    // Keep opaque in the final optional slot required by the Payment auth scheme.
    const credentialHeader = challenge.header;
    if (credentialHeader !== undefined && !isDefaultCredentialHeader(credentialHeader))
        values.push(credentialHeader);
    values.push(challenge.opaque ?? (challenge.meta ? PaymentRequest.serialize(challenge.meta) : ''));
    return values.join('|');
}
/** Returns the HTTP field name a client must use for a payment credential. */
export function credentialHeader(challenge) {
    return challenge.header ?? Constants.Headers.authorization;
}
/** Returns whether a credential header is the implicit HTTP authentication default. */
function isDefaultCredentialHeader(header) {
    return header?.toLowerCase() === Constants.Headers.authorization.toLowerCase();
}
/** @internal Computes HMAC-SHA256 challenge ID from parameters. */
function computeId(challenge, options) {
    // Each field occupies a fixed positional slot joined by '|'. Optional fields
    // use an empty string when absent so the slot count is stable — this avoids
    // ambiguity between e.g. (expires set, no digest) vs (no expires, digest set)
    // and means adding a new optional field changes all HMACs exactly once.
    const input = idBindingInput(challenge);
    const key = Bytes.fromString(options.secretKey);
    const data = Bytes.fromString(input);
    const mac = Hash.hmac256(key, data, { as: 'Bytes' });
    return Base64.fromBytes(mac, { url: true, pad: false });
}
//# sourceMappingURL=Challenge.js.map