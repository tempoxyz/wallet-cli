import type * as AttestationTypes from '../../attestation/Types.js';
import { Constants } from '../Constants.js';
/**
 * Creates a TAP request signer.
 *
 * The signer emits RFC 9421 HTTP message signatures with TAP's
 * `agent-browser-auth` or `agent-payer-auth` tag. Pass it to
 * `Attestation.Client.wrapFetch` so MPPX signs both the initial request and
 * its automatic paid retry.
 */
export declare function signer(config: signer.Config): AttestationTypes.Signer<typeof Constants.protocol>;
export declare namespace signer {
    type Config = {
        /** TAP signature type for the request. */
        intent: (typeof Constants.intents)[keyof typeof Constants.intents];
        /** Ed25519 or RSA-PSS SHA-512 private key provisioned to the agent provider. */
        key: CryptoKey;
        /** Identifier the merchant uses to resolve the signing public key. */
        keyId: string;
        /** Signature lifetime in seconds. TAP permits at most eight minutes. @default 480 */
        expiresIn?: number | undefined;
        /** RFC 9421 dictionary label. @default 'tap' */
        label?: string | undefined;
    };
}
//# sourceMappingURL=index.d.ts.map