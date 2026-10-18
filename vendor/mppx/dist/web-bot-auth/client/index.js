import { parseDictionary, serializeDictionary } from 'structured-headers';
import * as HttpMessageSignature from '../../attestation/internal/HttpMessageSignature.js';
import { Constants } from '../Constants.js';
import * as JwkThumbprint from '../internal/JwkThumbprint.js';
import * as SignatureAgent from '../internal/SignatureAgent.js';
/**
 * Creates a Web Bot Auth HTTPS-directory profile request signer.
 *
 * The signed `Signature-Agent` header links the request to the HTTPS origin
 * of an HTTP Message Signatures Directory. This adapter does not support
 * direct key configuration or other Web Bot Auth discovery types. It
 * establishes bot identity only; it does not assert consumer identity or
 * authority to make a payment.
 */
export function signer(config) {
    const label = config.label ?? Constants.label;
    const signatureAgentKey = config.signatureAgentKey ?? label;
    const expiresIn = config.expiresIn ?? Constants.defaultSignatureLifetime;
    const signatureAgent = SignatureAgent.directoryOrigin(config.signatureAgent);
    if (!JwkThumbprint.is(config.keyId))
        throw new TypeError('Web Bot Auth keyId must be an RFC 7638 SHA-256 JWK thumbprint.');
    if (!signatureAgent)
        throw new TypeError('Signature-Agent must identify a valid HTTPS origin.');
    if (!Number.isInteger(expiresIn) || expiresIn <= 0)
        throw new RangeError('Web Bot Auth expiresIn must be a positive integer.');
    return {
        protocol: Constants.protocol,
        sign(request, context) {
            const headers = new Headers(request.headers);
            const signatureAgents = parseSignatureAgents(headers);
            if (signatureAgents.has(signatureAgentKey))
                throw new Error(`Signature-Agent member "${signatureAgentKey}" already exists.`);
            signatureAgents.set(signatureAgentKey, [signatureAgent, new Map()]);
            headers.set(Constants.signatureAgentHeader, serializeDictionary(signatureAgents));
            return HttpMessageSignature.sign(new Request(request, { headers }), {
                components: [
                    HttpMessageSignature.Constants.components.authority,
                    {
                        id: HttpMessageSignature.Constants.components.signatureAgent,
                        parameters: new Map([['key', signatureAgentKey]]),
                    },
                ],
                context,
                expiresIn,
                key: config.key,
                keyId: config.keyId,
                label,
                tag: Constants.tag,
            });
        },
    };
}
function parseSignatureAgents(headers) {
    const value = headers.get(Constants.signatureAgentHeader);
    if (!value)
        return new Map();
    try {
        return parseDictionary(value);
    }
    catch {
        throw new Error(`HTTP header "${Constants.signatureAgentHeader}" is not a structured dictionary.`);
    }
}
//# sourceMappingURL=index.js.map