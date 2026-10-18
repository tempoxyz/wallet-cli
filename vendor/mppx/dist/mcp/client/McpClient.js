import * as Challenge from '../../Challenge.js';
import * as Credential from '../../Credential.js';
import * as Expires from '../../Expires.js';
import * as AcceptPayment from '../../internal/AcceptPayment.js';
import * as core_Mcp from '../../Mcp.js';
import * as z from '../../zod.js';
const MPPX_MCP_CLIENT_WRAPPER = Symbol.for('mppx.mcp.client.wrapper');
const maxPaymentAttempts = 3;
/**
 * Adds automatic payment handling to an MCP SDK client.
 *
 * The client's `callTool` method is replaced in place and the same reference
 * is returned, so surfaces that keep using the original client become
 * payment-aware — including when another SDK owns the client reference (e.g.
 * Cloudflare Agents). The MCP SDK `callTool(params, resultSchema?, options?)`
 * signature is preserved; pass a method's `context` or a per-call
 * `onPaymentRequired` approval hook via the options argument, where they are
 * stripped before the remaining request options are forwarded to the SDK.
 * Payment challenges are handled whether they arrive as payment-required
 * errors or as tool results carrying payment-required metadata. Calling
 * `wrap()` again replaces the payment configuration.
 *
 * @example
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client'
 * import { tempo } from 'mppx/client'
 * import { McpClient } from 'mppx/mcp/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = new Client({ name: 'my-client', version: '1.0.0' })
 * await client.connect(transport)
 *
 * McpClient.wrap(client, {
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Automatically handles payment challenges
 * const result = await client.callTool({ name: 'premium_tool', arguments: {} })
 * console.log(result.content, result.receipt)
 * ```
 */
export function wrap(client, config) {
    const target = client;
    const originalCallTool = target[MPPX_MCP_CLIENT_WRAPPER] ?? target.callTool;
    const callTool = createPaymentAwareCallTool(originalCallTool.bind(client), config);
    Object.defineProperty(target, MPPX_MCP_CLIENT_WRAPPER, {
        configurable: true,
        value: originalCallTool,
    });
    Object.defineProperty(target, 'callTool', {
        configurable: true,
        enumerable: false,
        value: (params, resultSchema, options) => {
            const { context, onPaymentRequired, ...requestOptions } = options ?? {};
            return callTool(params, {
                context,
                onPaymentRequired: onPaymentRequired === null ? undefined : (onPaymentRequired ?? config.onPaymentRequired),
                requestOptions: Object.keys(requestOptions).length
                    ? requestOptions
                    : undefined,
                resultSchema,
            });
        },
        writable: true,
    });
    return target;
}
/** Minimal wire shape of payment-required data; challenges are validated, extra fields pass through. */
const PaymentRequiredSchema = z.object({
    challenges: z.array(Challenge.Schema).check(z.minLength(1)),
});
/**
 * Checks if an error is a payment required error.
 */
export function isPaymentRequiredError(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    if (!('code' in error) || !('message' in error))
        return false;
    const code = error.code;
    if (code !== core_Mcp.paymentRequiredCode && code !== core_Mcp.paymentVerificationFailedCode)
        return false;
    return isPaymentRequiredData(error.data);
}
/** @internal */
async function createCredential(challenge, config) {
    const { context, methods } = config;
    const mi = methods.find((m) => m.name === challenge.method && m.intent === challenge.intent);
    if (!mi)
        throw new Error(`No method found for "${challenge.method}.${challenge.intent}". Available: ${methods.map((m) => `${m.name}.${m.intent}`).join(', ')}`);
    if (challenge.expires)
        Expires.assert(challenge.expires, challenge.id);
    const parsedContext = mi.context && context !== undefined ? mi.context.parse(context) : undefined;
    return mi.createCredential(parsedContext !== undefined ? { challenge, context: parsedContext } : { challenge });
}
function createPaymentAwareCallTool(callTool, config) {
    const methods = config.methods.flat();
    const paymentPreferences = AcceptPayment.resolve(methods, config.paymentPreferences);
    const retryWithPayment = async (params, call, paymentRequired, cause, attemptsRemaining = maxPaymentAttempts) => {
        const challenges = paymentRequired.challenges;
        const candidates = AcceptPayment.selectChallengeCandidates(challenges, methods, paymentPreferences.entries);
        const orderedCandidates = config.orderChallenges
            ? await config.orderChallenges(candidates)
            : candidates;
        const selected = orderedCandidates[0];
        if (!selected) {
            const available = challenges.map((challenge) => `${challenge.method}.${challenge.intent}`);
            const installed = methods.map((method) => `${method.name}.${method.intent}`);
            throw new Error(`No compatible payment method. Server offers: ${available.join(', ')}. Client has: ${installed.join(', ')}`, { cause });
        }
        if (selected.challenge.expires)
            Expires.assert(selected.challenge.expires, selected.challenge.id);
        if (call.onPaymentRequired) {
            const approved = await call.onPaymentRequired(selected.challenge);
            if (!approved)
                throw new Error('Payment declined.', { cause });
        }
        const credential = await createCredential(selected.challenge, {
            context: call.context,
            methods,
        });
        const parsed = Credential.deserialize(credential);
        try {
            const retryResult = await callTool({
                ...params,
                _meta: {
                    ...params._meta,
                    [core_Mcp.credentialMetaKey]: parsed,
                },
            }, call.resultSchema, call.requestOptions);
            const nextPaymentRequired = getPaymentRequiredMeta(retryResult);
            if (nextPaymentRequired && attemptsRemaining > 1)
                return retryWithPayment(params, call, nextPaymentRequired, retryResult, attemptsRemaining - 1);
            return withReceipt(retryResult);
        }
        catch (error) {
            if (!isPaymentRequiredError(error) || attemptsRemaining <= 1)
                throw error;
            return retryWithPayment(params, call, error.data, error, attemptsRemaining - 1);
        }
    };
    return async (params, call) => {
        try {
            const result = await callTool(params, call.resultSchema, call.requestOptions);
            const paymentRequired = getPaymentRequiredMeta(result);
            if (paymentRequired)
                return retryWithPayment(params, call, paymentRequired, result);
            return withReceipt(result);
        }
        catch (error) {
            if (!isPaymentRequiredError(error))
                throw error;
            return retryWithPayment(params, call, error.data, error);
        }
    };
}
function getPaymentRequiredMeta(result) {
    const data = result._meta?.[core_Mcp.paymentRequiredMetaKey];
    return isPaymentRequiredData(data) ? data : undefined;
}
function isPaymentRequiredData(value) {
    return PaymentRequiredSchema.safeParse(value).success;
}
function withReceipt(result) {
    return {
        ...result,
        receipt: result._meta?.[core_Mcp.receiptMetaKey],
    };
}
//# sourceMappingURL=McpClient.js.map