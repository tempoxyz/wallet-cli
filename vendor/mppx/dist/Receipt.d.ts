import * as z from './zod.js';
/** Base-field schema used only to derive the {@link Receipt} type without an index signature. */
declare const BaseSchema: z.ZodMiniObject<{
    method: z.ZodMiniString<string>;
    reference: z.ZodMiniString<string>;
    externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    subscriptionId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    status: z.ZodMiniLiteral<"success">;
    timestamp: z.ZodMiniString<string>;
}, z.core.$strip>;
/**
 * Schema for a payment receipt.
 *
 * Method specifications may define additional receipt fields beyond the
 * base set (per the core spec's Payment-Receipt section); unknown fields
 * are preserved through parse/serialize round-trips rather than stripped.
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const receipt = Receipt.Schema.parse(data)
 * ```
 */
export declare const Schema: z.ZodMiniObject<{
    method: z.ZodMiniString<string>;
    reference: z.ZodMiniString<string>;
    externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    subscriptionId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    status: z.ZodMiniLiteral<"success">;
    timestamp: z.ZodMiniString<string>;
}, z.core.$loose>;
/**
 * Payment receipt returned after verification.
 *
 * Method-specific extension fields are preserved at runtime but not part of
 * this base type; method packages can type them via intersection
 * (e.g. `Receipt.Receipt & { originTxHash: string }`).
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const receipt: Receipt.Receipt = {
 *   method: 'tempo',
 *   status: 'success',
 *   timestamp: new Date().toISOString(),
 *   reference: '0x...',
 * }
 * ```
 */
export type Receipt = z.infer<typeof BaseSchema>;
/**
 * Deserializes a Payment-Receipt header value to a receipt.
 *
 * @param encoded - The base64url-encoded header value.
 * @returns The deserialized receipt.
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const receipt = Receipt.deserialize(encoded)
 * ```
 */
export declare function deserialize(encoded: string): Receipt;
/**
 * Creates a receipt from the given parameters.
 *
 * @param parameters - Receipt parameters.
 * @returns A receipt.
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const receipt = Receipt.from({
 *   method: 'tempo',
 *   status: 'success',
 *   timestamp: new Date().toISOString(),
 *   reference: '0x...',
 * })
 * ```
 */
export declare function from(parameters: from.Parameters): Receipt;
export declare namespace from {
    type Parameters = z.input<typeof Schema>;
}
/**
 * Serializes a receipt to the Payment-Receipt header format.
 *
 * @param receipt - The receipt to serialize.
 * @returns A base64url-encoded string suitable for the Payment-Receipt header value.
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const header = Receipt.serialize(receipt)
 * // => "eyJzdGF0dXMiOiJzdWNjZXNzIiwidGltZXN0YW1wIjoi..."
 * ```
 */
export declare function serialize(receipt: Receipt): string;
/**
 * Extracts the receipt from a Response's Payment-Receipt header.
 *
 * @param response - The HTTP response.
 * @returns The deserialized receipt.
 *
 * @example
 * ```ts
 * import { Receipt } from 'mppx'
 *
 * const response = await fetch('/resource', {
 *   headers: { Authorization: Credential.serialize(credential) },
 * })
 * if (response.ok) {
 *   const receipt = Receipt.fromResponse(response)
 * }
 * ```
 */
export declare function fromResponse(response: Response): Receipt;
export {};
//# sourceMappingURL=Receipt.d.ts.map