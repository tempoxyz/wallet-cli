/** TAP values required for its RFC 9421 agent-recognition signature profile. */
export declare const Constants: {
    /** Stable identifier for Trusted Agent Protocol signers and replay storage. */
    readonly protocol: 'tap';
    /** RFC 9421 signature label used when no label is configured. */
    readonly label: 'tap';
    /** Maximum lifetime, in seconds, permitted by TAP for an agent signature. */
    readonly maximumSignatureLifetime: number;
    /** Default lifetime, in seconds, applied to TAP agent signatures. */
    readonly defaultSignatureLifetime: number;
    /** TAP tags that identify the signed interaction's intent. */
    readonly tags: {
        /** Tag for an agent browsing or discovering a merchant. */
        readonly browse: 'agent-browser-auth';
        /** Tag for an agent executing a payment-related interaction. */
        readonly payment: 'agent-payer-auth';
    };
    /** Commerce intents represented by TAP signature tags. */
    readonly intents: {
        /** An agent discovery or browsing interaction. */
        readonly browse: 'browse';
        /** An agent payment interaction. */
        readonly payment: 'payment';
    };
    /** HTTP components every TAP agent signature must cover. */
    readonly requiredComponents: readonly ["@authority", "@path"];
};
//# sourceMappingURL=Constants.d.ts.map