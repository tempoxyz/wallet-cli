/**
 * A body digest string in the format "algorithm=base64hash".
 *
 * @example
 * ```ts
 * import { BodyDigest } from 'mppx'
 *
 * const digest: BodyDigest.BodyDigest = 'sha-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE'
 * ```
 */
export type BodyDigest = `sha-256=${string}`;
/**
 * Computes a SHA-256 digest of the given body.
 *
 * @param body - The body to digest (string or object).
 * @returns A digest string in the format "sha-256=base64hash".
 *
 * @example
 * ```ts
 * import { BodyDigest } from 'mppx'
 *
 * const digest = BodyDigest.compute({ amount: '1000' })
 * // => 'sha-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE'
 * ```
 */
export declare function compute(body: Record<string, unknown> | string): BodyDigest;
/**
 * Verifies that a digest matches the given body.
 *
 * @param digest - The digest to verify.
 * @param body - The body to verify against.
 * @returns True if the digest matches, false otherwise.
 *
 * @example
 * ```ts
 * import { BodyDigest } from 'mppx'
 *
 * const isValid = BodyDigest.verify(digest, '{"amount":"1000"}')
 * ```
 */
export declare function verify(digest: BodyDigest, body: Record<string, unknown> | string): boolean;
//# sourceMappingURL=BodyDigest.d.ts.map