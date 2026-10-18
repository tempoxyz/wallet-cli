import { Base64 } from 'ox';
/** Creates the signing context for one outbound HTTP request attempt. */
export function create() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return Object.freeze({
        created: Math.floor(Date.now() / 1_000),
        nonce: Base64.fromBytes(bytes, { pad: false, url: true }),
    });
}
//# sourceMappingURL=SigningContext.js.map