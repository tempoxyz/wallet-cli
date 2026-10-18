/** Web Bot Auth values for the supported HTTPS-directory signature profile. */
export declare const Constants: {
    /** Stable identifier for Web Bot Auth signers and replay storage. */
    readonly protocol: 'web-bot-auth';
    /** Web Bot Auth discovery type supported by this adapter. */
    readonly discoveryType: 'directory';
    /** RFC 9421 signature label used when no label is configured. */
    readonly label: 'webbot';
    /** Tag identifying a Web Bot Auth request signature. */
    readonly tag: 'web-bot-auth';
    /** Structured HTTP header linking a bot signature to its HTTPS directory origin. */
    readonly signatureAgentHeader: 'Signature-Agent';
    /** Default lifetime, in seconds, for a bot request signature. */
    readonly defaultSignatureLifetime: 60;
    /** Default verifier limit, following the draft's recommended 24-hour maximum. */
    readonly defaultMaximumSignatureLifetime: number;
    /** HTTP components required by this directory profile. */
    readonly requiredComponents: readonly ["@authority", "signature-agent"];
};
//# sourceMappingURL=Constants.d.ts.map