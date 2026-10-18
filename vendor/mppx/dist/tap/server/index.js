import * as HttpMessageSignature from '../../attestation/internal/HttpMessageSignature.js';
import { Constants } from '../Constants.js';
/**
 * Creates a verifier for TAP agent-recognition signatures.
 *
 * TAP verifies trusted agent participation and request integrity. Consumer
 * recognition and payment-container verification stay protocol-specific and
 * are intentionally not inferred from this header-only verifier.
 */
export function verifier(config) {
    return {
        async verify(request) {
            const result = await HttpMessageSignature.verify(request, {
                keyResolver: config.keyResolver,
                maxAge: Constants.maximumSignatureLifetime,
                nonceNamespace: Constants.protocol,
                nonceStore: config.nonceStore,
                requiredComponents: Constants.requiredComponents,
                tag: [Constants.tags.browse, Constants.tags.payment],
            });
            if (result.status !== 'verified')
                return result;
            return {
                status: 'verified',
                value: {
                    keyId: result.input.keyId,
                    nonce: result.input.nonce,
                    intent: result.input.tag === Constants.tags.payment
                        ? Constants.intents.payment
                        : Constants.intents.browse,
                },
            };
        },
    };
}
//# sourceMappingURL=index.js.map