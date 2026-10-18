import { Hash, Hex } from 'ox';
/** Constant-time string comparison to prevent timing attacks. */
export function constantTimeEqual(a, b) {
    const hashA = Hash.sha256(Hex.fromString(a));
    const hashB = Hash.sha256(Hex.fromString(b));
    let result = 0;
    for (let i = 0; i < hashA.length; i++)
        result |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i);
    return result === 0;
}
//# sourceMappingURL=constantTimeEqual.js.map