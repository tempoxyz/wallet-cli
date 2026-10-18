import * as Credential from './Credential.js';
import * as Errors from './Errors.js';
import * as Expires from './Expires.js';
/**
 * Creates a payment method.
 *
 * @example
 * ```ts
 * import { z } from 'zod/mini'
 * import { Method } from 'mppx'
 *
 * const tempoCharge = Method.from({
 *   name: 'tempo',
 *   intent: 'charge',
 *   schema: {
 *     credential: {
 *       payload: z.object({
 *         signature: z.string(),
 *         type: z.literal('transaction'),
 *       }),
 *     },
 *     request: z.object({
 *       amount: z.string(),
 *       currency: z.string(),
 *       recipient: z.string(),
 *     }),
 *   },
 * })
 * ```
 */
export function from(method) {
    return method;
}
/**
 * Validates a credential against one of the configured methods.
 *
 * This checks credential structure, challenge expiry, and method-specific
 * validation. It does not prove that the challenge was issued by a particular
 * server; hosts that issue challenges must verify that binding separately.
 */
export async function validateCredential(methods, input) {
    const prepared = prepareCredential(methods, input);
    if (!prepared.method.validate)
        throw new Errors.VerificationFailedError({
            details: { intent: prepared.method.intent, method: prepared.method.name },
            reason: `${prepared.method.name}/${prepared.method.intent} does not support non-mutating credential validation`,
        });
    return prepared.method.validate({
        credential: prepared.credential,
        request: prepared.request,
    });
}
/**
 * Re-validates and performs the terminal payment operation for a credential.
 *
 * This does not prove that the challenge was issued by a particular server;
 * hosts that issue challenges must verify that binding separately.
 */
export async function broadcastCredential(methods, input) {
    const prepared = prepareCredential(methods, input);
    const { method } = prepared;
    if (method.broadcast && method.validate)
        await method.validate({ credential: prepared.credential, request: prepared.request });
    const broadcast = method.broadcast ?? method.verify;
    return broadcast({ credential: prepared.credential, request: prepared.request });
}
/**
 * Parses a submitted credential into the inputs required for method execution.
 *
 * Dispatch is based on the challenge method and intent. The helper then asserts
 * challenge expiry and parses the method-specific credential payload before
 * returning the selected method and the unmodified challenge request.
 *
 * This intentionally does not verify that the challenge was issued by a
 * particular host, authorize the caller or requested resource, validate the
 * method request, or invoke method lifecycle hooks. Hosts that issue challenges
 * must verify their challenge binding before accepting the credential.
 */
function prepareCredential(methods, input) {
    const credential = typeof input === 'string' ? Credential.deserialize(input) : input;
    const candidates = methods.filter((method) => method.name === credential.challenge.method && method.intent === credential.challenge.intent);
    const method = candidates[0];
    if (!method)
        throw new Errors.InvalidChallengeError({
            id: credential.challenge.id,
            reason: `no registered method for ${credential.challenge.method}/${credential.challenge.intent}`,
        });
    Expires.assert(credential.challenge.expires, credential.challenge.id);
    let payload;
    try {
        payload = method.schema.credential.payload.parse(credential.payload);
    }
    catch (error) {
        throw new Errors.InvalidPayloadError(error instanceof Error ? { reason: error.message } : {});
    }
    return {
        credential: { ...credential, payload },
        method,
        request: credential.challenge.request,
    };
}
/**
 * Extends a method with client-side credential creation logic.
 *
 * @example
 * ```ts
 * import { Method } from 'mppx'
 * import { Methods } from 'mppx/tempo'
 *
 * const tempoCharge = Method.toClient(Methods.charge, {
 *   async createCredential({ challenge }) {
 *     return Credential.serialize({ challenge, payload: { ... } })
 *   },
 * })
 * ```
 */
export function toClient(method, options) {
    const { canHandleChallenge, context, createCredential } = options;
    return {
        ...method,
        canHandleChallenge,
        context,
        createCredential,
    };
}
/**
 * Extends a method with server-side verification logic.
 *
 * @example
 * ```ts
 * import { Method } from 'mppx'
 * import { Methods } from 'mppx/tempo'
 *
 * const tempoCharge = Method.toServer(Methods.charge, {
 *   async verify({ credential }) {
 *     // verification logic
 *     return { status: 'success', ... }
 *   },
 * })
 * ```
 */
export function toServer(method, options) {
    const { alias, authorize, canOffer, defaults, extensions, html, onPaymentSuccess, preflight, request, respond, broadcast, stableBinding, transport, validate, verify, } = options;
    const effectiveVerify = verify ??
        (async (parameters) => {
            if (validate)
                await validate(parameters);
            if (!broadcast)
                throw new Errors.VerificationFailedError({
                    reason: `${method.name}/${method.intent} does not support credential broadcast`,
                });
            return broadcast(parameters);
        });
    return {
        ...method,
        alias,
        authorize,
        canOffer,
        defaults,
        extensions,
        html,
        onPaymentSuccess,
        preflight,
        request,
        respond,
        broadcast,
        stableBinding,
        transport,
        validate,
        verify: effectiveVerify,
    };
}
//# sourceMappingURL=Method.js.map