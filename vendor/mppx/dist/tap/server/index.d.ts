import type * as Attestation from '../../attestation/Types.js';
import type * as Store from '../../Store.js';
import type * as Types from '../Types.js';
/**
 * Creates a verifier for TAP agent-recognition signatures.
 *
 * TAP verifies trusted agent participation and request integrity. Consumer
 * recognition and payment-container verification stay protocol-specific and
 * are intentionally not inferred from this header-only verifier.
 */
export declare function verifier(config: verifier.Config): Attestation.Verifier<Types.VerifiedRequest>;
export declare namespace verifier {
    type Config = {
        /** Resolves a TAP-approved public key by its `keyid` and signature algorithm. */
        keyResolver: Attestation.KeyResolver;
        /** Atomically consumes each nonce in shared storage for multi-instance deployments. */
        nonceStore: Store.AtomicStore;
    };
}
//# sourceMappingURL=index.d.ts.map