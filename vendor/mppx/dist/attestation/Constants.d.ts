/** RFC 9421 signature algorithms supported by request attestation. */
export declare const Algorithms: {
    /** EdDSA using the Ed25519 curve. */
    readonly ed25519: 'ed25519';
    /** RSASSA-PSS using SHA-512 and a 64-byte salt. */
    readonly rsaPssSha512: 'rsa-pss-sha512';
};
/** HTTP headers defined by RFC 9421 for request-attestation signatures. */
export declare const Headers: {
    /** Carries the RFC 9421 signature bytes. */
    readonly signature: 'Signature';
    /** Carries the RFC 9421 covered components and signature parameters. */
    readonly signatureInput: 'Signature-Input';
};
//# sourceMappingURL=Constants.d.ts.map