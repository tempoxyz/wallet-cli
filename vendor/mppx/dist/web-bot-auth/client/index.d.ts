import type * as AttestationTypes from '../../attestation/Types.js';
import { Constants } from '../Constants.js';
/**
 * Creates a Web Bot Auth HTTPS-directory profile request signer.
 *
 * The signed `Signature-Agent` header links the request to the HTTPS origin
 * of an HTTP Message Signatures Directory. This adapter does not support
 * direct key configuration or other Web Bot Auth discovery types. It
 * establishes bot identity only; it does not assert consumer identity or
 * authority to make a payment.
 */
export declare function signer(config: signer.Config): AttestationTypes.Signer<typeof Constants.protocol>;
export declare namespace signer {
    type Config = {
        /** Ed25519 or RSA-PSS SHA-512 private key registered for the bot. */
        key: CryptoKey;
        /** RFC 7638 JWK thumbprint for the registered public key. */
        keyId: string;
        /** Required HTTPS directory origin, sent with the default `directory` discovery type. */
        signatureAgent: string;
        /** Dictionary member name used for `Signature-Agent`. @default signature label */
        signatureAgentKey?: string | undefined;
        /** Signature lifetime in seconds. @default 60 */
        expiresIn?: number | undefined;
        /** RFC 9421 dictionary label. @default 'webbot' */
        label?: string | undefined;
    };
}
//# sourceMappingURL=index.d.ts.map