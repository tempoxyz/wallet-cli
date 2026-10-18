import type { OneOf } from './internal/types.js';
import type * as Method from './Method.js';
import * as PaymentRequest from './PaymentRequest.js';
import * as z from './zod.js';
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
export declare const Schema: z.ZodMiniObject<{
    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
    digest: z.ZodMiniOptional<z.ZodMiniString<string>>;
    expires: z.ZodMiniOptional<z.ZodMiniString<string>>;
    header: z.ZodMiniOptional<z.ZodMiniString<string>>;
    id: z.ZodMiniString<string>;
    intent: z.ZodMiniString<string>;
    method: z.ZodMiniString<string>;
    meta: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniString<string>>>;
    opaque: z.ZodMiniOptional<z.ZodMiniString<string>>;
    realm: z.ZodMiniString<string>;
    request: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
}, z.core.$strip>;
/**
 * A parsed payment challenge from a `WWW-Authenticate` header.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 *
 * const challenge: Challenge.Challenge = {
 *   id: 'abc123',
 *   realm: 'api.example.com',
 *   method: 'tempo',
 *   intent: 'charge',
 *   request: { amount: '1000000', currency: '0x...', recipient: '0x...' },
 * }
 * ```
 */
export type Challenge<request = Record<string, unknown>, intent extends string = string, method extends string = string> = Omit<z.infer<typeof Schema>, 'intent' | 'method' | 'request'> & {
    intent: intent;
    method: method;
    request: request;
};
/**
 * Extracts a union of challenge types from an array of methods.
 */
export type FromMethods<methods extends readonly Method.Method[]> = {
    [method in keyof methods]: Challenge<z.output<methods[method]['schema']['request']>, methods[method]['intent'], methods[method]['name']>;
}[number];
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
export declare function from<const parameters extends from.Parameters, const methods extends readonly Method.Method[] | undefined = undefined>(parameters: parameters, options?: from.Options<methods>): from.ReturnType<parameters, methods>;
export declare namespace from {
    type Options<methods extends readonly Method.Method[] | undefined = undefined> = {
        methods?: methods;
    };
    type Parameters = OneOf<{
        /** Explicit challenge ID. */
        id: string;
    } | {
        /** Secret key for HMAC-bound challenge ID. */
        secretKey: string;
    }> & {
        /** Optional human-readable description of the payment. */
        description?: string | undefined;
        /** Optional digest of the request body. */
        digest?: string | undefined;
        /** Optional expiration timestamp (ISO 8601). */
        expires?: z.DatetimeInput | undefined;
        /** Optional HTTP field name to carry the payment credential. When omitted, uses Authorization. */
        header?: string | undefined;
        /** Intent type (e.g., "charge", "session"). */
        intent: string;
        /** Optional server-defined correlation data (serialized as `opaque` on the challenge). Flat string-to-string map; clients MUST NOT modify. */
        meta?: Record<string, string> | undefined;
        /** Optional raw base64url-encoded server-defined correlation data. Clients MUST NOT modify. */
        opaque?: string | undefined;
        /** Payment method (e.g., "tempo", "stripe"). */
        method: string;
        /** Server realm (e.g., hostname). */
        realm: string;
        /** Method-specific request data. */
        request: PaymentRequest.Request;
    };
    type ReturnType<parameters extends Parameters, methods extends readonly Method.Method[] | undefined = undefined> = methods extends readonly Method.Method[] ? FromMethods<methods> : Challenge<parameters['request']>;
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
export declare function fromMethod<const method extends Method.Method>(method: method, parameters: fromMethod.Parameters<method>): fromMethod.ReturnType<method>;
export declare namespace fromMethod {
    type Parameters<method extends Method.Method> = OneOf<{
        /** Explicit challenge ID. */
        id: string;
    } | {
        /** Secret key for HMAC-bound challenge ID. */
        secretKey: string;
    }> & {
        /** Optional human-readable description of the payment. */
        description?: string | undefined;
        /** Optional digest of the request body. */
        digest?: string | undefined;
        /** Optional expiration timestamp (ISO 8601). */
        expires?: z.DatetimeInput | undefined;
        /** Optional HTTP field name to carry the payment credential. When omitted, uses Authorization. */
        header?: string | undefined;
        /** Optional server-defined correlation data (serialized as `opaque` on the challenge). Flat string-to-string map; clients MUST NOT modify. */
        meta?: Record<string, string> | undefined;
        /** Server realm (e.g., hostname). */
        realm: string;
        /** Method-specific request data. */
        request: z.input<method['schema']['request']>;
    };
    type ReturnType<method extends Method.Method> = Challenge<z.output<method['schema']['request']>>;
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
export declare function serialize(challenge: Challenge): string;
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
export declare function deserialize<const methods extends readonly Method.Method[] | undefined = undefined>(value: string, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>;
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
export declare function fromHeaders<const methods extends readonly Method.Method[] | undefined = undefined>(headers: Headers, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>;
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
export declare function fromResponse<const methods extends readonly Method.Method[] | undefined = undefined>(response: Response, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>;
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
export declare function fromResponseList<const methods extends readonly Method.Method[] | undefined = undefined>(response: Response, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>[];
/**
 * Extracts all Payment challenges from a Headers object with potentially
 * merged `WWW-Authenticate` values.
 *
 * @param headers - The HTTP headers.
 * @param options - Optional settings to narrow the challenge type.
 * @returns An array of deserialized challenges.
 */
export declare function fromHeadersList<const methods extends readonly Method.Method[] | undefined = undefined>(headers: Headers, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>[];
/**
 * Deserializes a `WWW-Authenticate` header value that may contain multiple
 * Payment challenges (comma-separated per RFC 9110 §11.6.1).
 *
 * @param value - The raw WWW-Authenticate header value.
 * @param options - Optional settings to narrow the challenge type.
 * @returns An array of deserialized challenges.
 */
export declare function deserializeList<const methods extends readonly Method.Method[] | undefined = undefined>(value: string, options?: from.Options<methods>): from.ReturnType<from.Parameters, methods>[];
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
export declare function verify(challenge: Challenge, options: verify.Options): boolean;
export declare namespace verify {
    type Options = {
        /** Secret key for HMAC-bound challenge ID verification. */
        secretKey: string;
    };
}
/** Extracts parsed server-defined correlation data from a challenge when available. */
export declare function meta(challenge: Challenge): Record<string, string> | undefined;
/** Returns the HTTP field name a client must use for a payment credential. */
export declare function credentialHeader(challenge: Challenge): string;
//# sourceMappingURL=Challenge.d.ts.map