import type * as Attestation from '../../attestation/Types.js';
import type * as Store from '../../Store.js';
import type * as Types from '../Types.js';
/**
 * Creates a verifier for the Web Bot Auth HTTPS-directory profile.
 *
 * It requires an `@authority` and signed `Signature-Agent` directory member;
 * direct key configuration and other Web Bot Auth discovery types are outside
 * this adapter's scope. Verification confirms the cryptographic identity of an
 * automated HTTP client. It must not be used on its own as user or payment
 * authorization.
 */
export declare function verifier(config: verifier.Config): Attestation.Verifier<Types.VerifiedRequest>;
export declare namespace verifier {
    type Config = {
        /**
         * Resolves a public key for the advertised directory.
         *
         * Apply the origin's trust policy before any network lookup; do not fetch an
         * arbitrary caller-provided `signatureAgent` URL. Returned public keys
         * must be extractable so their RFC 7638 thumbprints can be verified.
         */
        keyResolver: (parameters: {
            algorithm: Attestation.SignatureAlgorithm;
            keyId: string;
            request: Request;
            signatureAgent: string;
        }) => Promise<CryptoKey | undefined> | CryptoKey | undefined;
        /** Maximum accepted signature lifetime in seconds. @default 86400 */
        maxAge?: number | undefined;
        /** Atomically consumes each nonce in shared storage for multi-instance deployments. */
        nonceStore: Store.AtomicStore;
    };
}
//# sourceMappingURL=index.d.ts.map