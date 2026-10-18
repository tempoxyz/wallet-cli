const x402Challenge = Symbol.for('mppx.x402.challenge');
/** Marks a synthetic challenge as originating from an x402 `PAYMENT-REQUIRED` response. */
export function mark(challenge) {
    Object.defineProperty(challenge, x402Challenge, {
        value: true,
    });
    return challenge;
}
/** Returns whether a challenge originated from an x402 `PAYMENT-REQUIRED` response. */
export function is(challenge) {
    return Boolean(challenge?.[x402Challenge]);
}
//# sourceMappingURL=ChallengeBrand.js.map