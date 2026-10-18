import { Bytes, Hash, Hex, Json } from 'ox';
import { PaymentExpiredError, VerificationFailedError } from '../../Errors.js';
import * as Receipt from '../../Receipt.js';
const defaultApiBaseUrl = 'https://api.tempo.xyz';
const relayErrorCode = [
    'already_used',
    'broadcast_failed',
    'expired',
    'invalid_payment',
    'insufficient_funds',
    'policy_denied',
    'screen_rejected',
    'simulation_failed',
    'temporarily_unavailable',
    'unsupported',
    'unknown',
];
/**
 * Configures a Tempo payment method to use Tempo API's MPP relay.
 *
 * The adapter preserves the supplied method's challenge configuration while
 * delegating validation and finalization to `/v1/mpp/validate` and
 * `/v1/mpp/broadcast`. The relay receives every submitted credential: it
 * broadcasts pull transactions and finalizes push transaction hashes without
 * sending them again.
 *
 * @internal
 */
export function configure(method, options) {
    const request = createRequest(options);
    const validate = async (parameters) => {
        const input = toRelayInput(parameters.credential);
        await request.validate(input);
        return {
            challenge: parameters.credential.challenge,
            credential: parameters.credential,
            details: {},
            intent: method.intent,
            method: method.name,
            request: parameters.credential.challenge.request,
            ...(parameters.credential.source ? { source: parameters.credential.source } : {}),
        };
    };
    const broadcast = async (parameters) => {
        const input = toRelayInput(parameters.credential);
        const receipt = await request.broadcast(input, {
            idempotencyKey: idempotencyKey(input),
        });
        if (receipt.method !== method.name)
            throw failure();
        try {
            return Receipt.from({ ...receipt, status: 'success' });
        }
        catch {
            throw failure();
        }
    };
    // Preserve the legacy combined hook for direct method consumers.
    const verify = async (parameters) => {
        await validate(parameters);
        return broadcast(parameters);
    };
    return {
        ...method,
        broadcast,
        verify,
        validate,
    };
}
function createRequest(options) {
    const fetch = options.fetch ?? globalThis.fetch;
    const apiBaseUrl = new URL(options.apiBaseUrl ?? defaultApiBaseUrl);
    if (!apiBaseUrl.pathname.endsWith('/'))
        apiBaseUrl.pathname += '/';
    async function post(path, input, headers) {
        let response;
        try {
            response = await fetch(new URL(path, apiBaseUrl), {
                body: JSON.stringify(input),
                headers: {
                    Accept: 'application/json',
                    'content-type': 'application/json',
                    'tempo-api-key': options.apiKey,
                    ...headers,
                },
                method: 'POST',
            });
        }
        catch {
            throw failure();
        }
        if (!response.ok)
            throw failure();
        return response.json().catch(() => undefined);
    }
    const validate = async (input) => {
        const response = await post('v1/mpp/validate', input);
        if (!isValidateSuccess(response))
            throw failure(response);
    };
    const broadcast = async (input, broadcastOptions) => {
        const response = await post('v1/mpp/broadcast', input, {
            'idempotency-key': broadcastOptions.idempotencyKey,
        });
        if (!isBroadcastSuccess(response))
            throw failure(response);
        return response.receipt;
    };
    return {
        broadcast,
        validate,
    };
}
function toRelayInput(credential) {
    return {
        challenge: credential.challenge,
        payload: credential.payload,
        ...(credential.source ? { source: credential.source } : {}),
    };
}
function idempotencyKey(input) {
    const payload = input.payload;
    if (isRecord(payload) &&
        payload.type === 'transaction' &&
        typeof payload.signature === 'string' &&
        Hex.validate(payload.signature)) {
        const transactionHash = Hash.keccak256(Hex.toBytes(payload.signature), { as: 'Hex' });
        return `mpp_${transactionHash}`;
    }
    const hash = Hash.sha256(Bytes.fromString(Json.canonicalize(input)), { as: 'Hex' });
    return `mpp_${hash}`;
}
function failure(value) {
    const code = relayErrorCodeFrom(value);
    if (code === 'expired')
        return new PaymentExpiredError();
    const details = code && safeDetails(code);
    return new VerificationFailedError(details ? { details } : undefined);
}
function isValidateSuccess(value) {
    return isRecord(value) && value.success === true;
}
function isBroadcastSuccess(value) {
    return isRecord(value) && value.success === true && isRelayReceipt(value.receipt);
}
function relayErrorCodeFrom(value) {
    if (!isRecord(value) || !isRecord(value.error) || !isRelayErrorCode(value.error.code))
        return;
    return value.error.code;
}
function isRelayErrorCode(value) {
    return typeof value === 'string' && relayErrorCode.includes(value);
}
function safeDetails(code) {
    switch (code) {
        case 'already_used':
        case 'broadcast_failed':
        case 'insufficient_funds':
        case 'invalid_payment':
        case 'simulation_failed':
        case 'unsupported':
            return { code };
        case 'temporarily_unavailable':
            return { code, retry: 'same_credential' };
        default:
            return;
    }
}
function isRelayReceipt(value) {
    return (isRecord(value) &&
        typeof value.method === 'string' &&
        typeof value.reference === 'string' &&
        typeof value.timestamp === 'string' &&
        (value.externalId === undefined || typeof value.externalId === 'string'));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=Relay.js.map