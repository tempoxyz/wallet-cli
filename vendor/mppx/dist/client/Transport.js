import * as Credential from '../Credential.js';
import * as Mcp from '../Mcp.js';
import { mcp as mcpProtocol, paymentRequiredData } from './internal/protocols/Mcp.js';
import { mpp as mppProtocol } from './internal/protocols/Mpp.js';
import { paymentRequiredStatus } from './internal/protocols/Shared.js';
import { x402 as x402Protocol } from './internal/protocols/X402.js';
/**
 * Creates a custom client-side transport.
 *
 * @example
 * ```ts
 * import { Transport } from 'mppx/client'
 *
 * const custom = Transport.from({
 *   name: 'custom',
 *   isPaymentRequired(response) { ... },
 *   getChallenges(response) { ... },
 *   setCredential(request, credential) { ... },
 * })
 * ```
 */
export function from(transport) {
    return transport;
}
/** HTTP transport that composes payment protocols while keeping `fetch` as the single boundary. */
export function http() {
    const protocols = [mppProtocol(), x402Protocol(), mcpProtocol()];
    const protocolForChallenge = new WeakMap();
    const remember = (protocol, challenges) => {
        for (const challenge of challenges)
            protocolForChallenge.set(challenge, protocol);
        return challenges;
    };
    // Collect every protocol offer. Header-only 402 paths stay synchronous; MCP returns a promise
    // only when it has to inspect a JSON-RPC/SSE body.
    const collect = (response, request) => {
        const collectFrom = (index, collected) => {
            for (let i = index; i < protocols.length; i++) {
                const protocol = protocols[i];
                const challenges = protocol.getChallenges(response, request);
                if (challenges instanceof Promise)
                    return challenges.then((list) => collectFrom(i + 1, [...collected, ...remember(protocol, list)]));
                collected.push(...remember(protocol, challenges));
            }
            return collected;
        };
        return collectFrom(0, []);
    };
    return from({
        name: 'http',
        isPaymentRequired(response, request) {
            if (response.status === paymentRequiredStatus)
                return true; // HTTP 402 — sync fast path
            const challenges = collect(response, request);
            return challenges instanceof Promise
                ? challenges.then((list) => list.length > 0)
                : challenges.length > 0;
        },
        getChallenges(response, request) {
            return collect(response, request);
        },
        setCredential(request, credential, options) {
            const protocol = options?.challenge ? protocolForChallenge.get(options.challenge) : undefined;
            const fallback = protocols[0];
            if (!protocol && !fallback)
                throw new Error('No protocol to attach the credential.');
            return (protocol ?? fallback).setCredential(request, credential, options);
        },
    });
}
function mcpPaymentRequiredChallenges(response) {
    const data = paymentRequiredData(response);
    if (!data)
        throw new Error('No challenge in response.');
    return data.challenges;
}
/**
 * MCP protocol transport for direct JSON-RPC objects.
 *
 * Prefer {@link http} for MCP-over-HTTP fetches; this remains for callers that already operate on
 * parsed MCP request/response objects.
 */
export function mcp() {
    return from({
        name: 'mcp',
        isPaymentRequired(response) {
            return !!paymentRequiredData(response);
        },
        getChallenges(response) {
            return mcpPaymentRequiredChallenges(response);
        },
        setCredential(request, credential) {
            const parsed = Credential.deserialize(credential);
            return {
                ...request,
                params: {
                    ...request.params,
                    ['_meta']: {
                        ...request.params?.['_meta'],
                        [Mcp.credentialMetaKey]: parsed,
                    },
                },
            };
        },
    });
}
//# sourceMappingURL=Transport.js.map