import type * as z from '../zod.js';
/**
 * Creates a typed codec for JSON HTTP header values.
 *
 * x402 uses plain base64 JSON header bodies, while the Payment auth scheme uses
 * its own base64url/JCS serializers. Keep this helper internal so transports
 * can opt into the exact wire encoding their protocol expects.
 */
export declare function createJson<const schema extends z.ZodMiniType>(schema: schema): {
    encode(value: z.infer<schema>): string;
    decode(value: string): z.infer<schema>;
};
/** Error thrown when a JSON header value is not valid base64-encoded JSON. */
export declare class InvalidJsonHeaderError extends Error {
    readonly name = "InvalidJsonHeaderError";
    constructor();
}
//# sourceMappingURL=HeaderCodec.d.ts.map