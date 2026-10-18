import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { createPaymentWrapper, MCP_PAYMENT_META_KEY, } from '@x402/mcp';
import * as Challenge from '../Challenge.js';
import * as Errors from '../Errors.js';
import * as Negotiator from '../integrations/x402/Negotiator.js';
import * as Mcp from '../Mcp.js';
import * as McpCredential from '../mcp/internal/Credential.js';
import * as Receipt from '../Receipt.js';
import { paymentRequiredHeader } from './Types.js';
/**
 * Creates an MCP tool wrapper that accepts both MPP and x402 payment metadata.
 *
 * Existing x402 credentials and lifecycle hooks continue through `@x402/mcp`.
 * MPP credentials reuse the same x402 requirements, verifier, and facilitator;
 * x402-only hooks in `PaymentWrapperConfig.hooks` therefore run only on x402 calls.
 */
export function mpp(resourceServer, config) {
    const toolName = parseToolName(config.resource.url);
    const x402 = createPaymentWrapper(resourceServer, config);
    const resourceUrl = config.resource.url;
    const route = {
        accepts: config.accepts.map(toPaymentOption),
        ...(config.extensions ? { extensions: config.extensions } : {}),
        ...(config.resource.description ? { description: config.resource.description } : {}),
        ...(config.resource.mimeType ? { mimeType: config.resource.mimeType } : {}),
        resource: resourceUrl,
    };
    const negotiator = Negotiator.create({
        routes: route,
        server: resourceServer,
        secretKey: config.secretKey,
        ...(config.realm ? { realm: config.realm } : {}),
    });
    return (handler) => {
        const x402Handler = x402(handler);
        return async (arguments_, rawExtra) => {
            const extra = (rawExtra ?? {});
            if (extra._meta?.[MCP_PAYMENT_META_KEY])
                return x402Handler(arguments_, rawExtra);
            const credential = McpCredential.parse(extra._meta?.[Mcp.credentialMetaKey]);
            const headers = new Headers({
                Accept: 'application/json',
                'Content-Type': 'application/json',
            });
            if (credential)
                headers.set('Authorization', credential.header);
            const request = new Request('https://mppx.invalid/tool', {
                body: JSON.stringify(arguments_),
                headers,
                method: 'POST',
            });
            const result = await negotiator.negotiate(request, Negotiator.createContext(request, arguments_));
            if (result.status === 'unprotected')
                return x402Handler(arguments_, rawExtra);
            if (result.status === 'x402')
                return x402Handler(arguments_, rawExtra);
            if (result.status === 'handled') {
                if (result.response.status === 402)
                    throw createCombinedChallenge(result.response, credential ? new Errors.VerificationFailedError() : undefined);
                return attachReceipt(await responseToToolResult(result.response.clone()), result.response, credential);
            }
            const toolResult = await handler(arguments_, {
                arguments: arguments_,
                ...(extra._meta ? { meta: extra._meta } : {}),
                toolName,
            });
            if (!credential)
                return toolResult;
            const response = result.withReceipt(Response.json(toolResult));
            return attachReceipt(toolResult, response, credential);
        };
    };
}
function attachReceipt(result, response, credential) {
    if (!credential || !response.headers.has('Payment-Receipt'))
        return result;
    const receipt = Receipt.fromResponse(response);
    return {
        ...result,
        _meta: {
            ...result._meta,
            [Mcp.receiptMetaKey]: {
                ...receipt,
                challengeId: credential.value.challenge.id,
            },
        },
    };
}
/** Converts an HTTP-side bridge response into a valid MCP tool result. */
async function responseToToolResult(response) {
    const text = await response.text();
    const value = parseResponseBody(text, response.headers.get('Content-Type'));
    if (isWrappedToolResult(value))
        return value;
    const message = getErrorMessage(value) ?? (text || `HTTP ${response.status}`);
    return {
        content: [{ text: message, type: 'text' }],
        ...(response.status >= 400 ? { isError: true } : {}),
        ...(isRecord(value) && response.status < 400 ? { structuredContent: value } : {}),
    };
}
function parseResponseBody(text, contentType) {
    if (!text || !contentType?.includes('application/json'))
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
function isWrappedToolResult(value) {
    return isRecord(value) && Array.isArray(value.content);
}
function getErrorMessage(value) {
    return isRecord(value) && typeof value.error === 'string' ? value.error : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function createCombinedChallenge(response, error) {
    const challenges = Challenge.fromResponseList(response);
    const encoded = response.headers.get(paymentRequiredHeader);
    const x402 = encoded ? decodePaymentRequiredHeader(encoded) : undefined;
    return new McpError(Mcp.errorCode(error), error?.title ?? 'Payment Required', {
        challenges,
        httpStatus: 402,
        ...(x402 ? { x402 } : {}),
    });
}
function toPaymentOption(requirement) {
    return {
        network: requirement.network,
        payTo: requirement.payTo,
        price: {
            amount: requirement.amount,
            asset: requirement.asset,
            ...(requirement.extra ? { extra: requirement.extra } : {}),
        },
        scheme: requirement.scheme,
        ...(requirement.extra ? { extra: requirement.extra } : {}),
        ...(requirement.maxTimeoutSeconds ? { maxTimeoutSeconds: requirement.maxTimeoutSeconds } : {}),
    };
}
function parseToolName(resource) {
    if (!resource.startsWith('mcp://tool/'))
        throw new Error('MPP x402 MCP resources must use mcp://tool/{toolName}.');
    const toolName = resource.slice('mcp://tool/'.length);
    if (!toolName || toolName.includes('/') || toolName.includes('?') || toolName.includes('#'))
        throw new Error('MPP x402 MCP resources must use mcp://tool/{toolName}.');
    return toolName;
}
//# sourceMappingURL=mcp.js.map