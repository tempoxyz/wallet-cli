/**
 * Asserts that `expires` is present, well-formed, and not in the past.
 *
 * Throws `InvalidChallengeError` when missing or malformed,
 * and `PaymentExpiredError` when the timestamp is in the past.
 */
export declare function assert(expires: string | undefined, challengeId?: string): asserts expires is string;
/** Returns an ISO 8601 datetime string `n` days from now. */
export declare function days(n: number): string;
/** Returns an ISO 8601 datetime string `n` hours from now. */
export declare function hours(n: number): string;
/** Returns an ISO 8601 datetime string `n` minutes from now. */
export declare function minutes(n: number): string;
/** Returns an ISO 8601 datetime string `n` months (30 days) from now. */
export declare function months(n: number): string;
/** Returns an ISO 8601 datetime string `n` seconds from now. */
export declare function seconds(n: number): string;
/** Returns an ISO 8601 datetime string `n` weeks from now. */
export declare function weeks(n: number): string;
/** Returns an ISO 8601 datetime string `n` years (365 days) from now. */
export declare function years(n: number): string;
//# sourceMappingURL=Expires.d.ts.map