/** Returns whether a value has the RFC 7638 SHA-256 thumbprint encoding. */
export declare function is(value: string): boolean;
/** Derives an RFC 7638 thumbprint from an extractable Ed25519 or RSA public key. */
export declare function fromKey(key: CryptoKey): Promise<string>;
//# sourceMappingURL=JwkThumbprint.d.ts.map