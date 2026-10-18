import { Base64, Json } from 'ox';
/**
 * Deserializes a base64url string to a request.
 *
 * @param encoded - The base64url-encoded string.
 * @returns The deserialized request.
 *
 * @example
 * ```ts
 * import { PaymentRequest } from 'mppx'
 *
 * const request = PaymentRequest.deserialize(serialized)
 * ```
 */
export function deserialize(encoded) {
    const json = Base64.toString(encoded);
    return JSON.parse(json);
}
/**
 * Creates a request from the given parameters.
 *
 * @param request - Request parameters.
 * @returns A request.
 *
 * @example
 * ```ts
 * import { PaymentRequest } from 'mppx'
 *
 * const request = PaymentRequest.from({
 *   amount: '1000000',
 *   currency: '0x20c0000000000000000000000000000000000001',
 *   recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
 * })
 * ```
 */
export function from(request) {
    return request;
}
/**
 * Creates a validated request from a method intent.
 *
 * @param method - The method to validate against.
 * @param request - Request parameters.
 * @returns A validated request.
 *
 * @example
 * ```ts
 * import { PaymentRequest } from 'mppx'
 * import { Methods } from 'mppx/tempo'
 *
 * const request = PaymentRequest.fromMethod(Methods.charge, {
 *   amount: '1000000',
 *   currency: '0x20c0000000000000000000000000000000000001',
 *   recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
 *   expires: '2025-01-06T12:00:00Z',
 *   chainId: 42431,
 * })
 * ```
 */
export function fromMethod(method, request) {
    return method.schema.request.parse(request);
}
/**
 * Serializes a request to a base64url string.
 *
 * @param request - The request to serialize.
 * @returns A base64url-encoded string (no padding).
 *
 * @example
 * ```ts
 * import { PaymentRequest } from 'mppx'
 *
 * const serialized = PaymentRequest.serialize(request)
 * // => "eyJhbW91bnQiOiIxMDAwMDAwIiwiY3VycmVuY3kiOiIweC4uLiJ9"
 * ```
 */
export function serialize(request) {
    const json = Json.canonicalize(request);
    return Base64.fromString(json, { pad: false, url: true });
}
//# sourceMappingURL=PaymentRequest.js.map