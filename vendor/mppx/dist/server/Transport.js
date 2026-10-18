import * as Challenge from '../Challenge.js';
import * as Constants from '../Constants.js';
import * as Credential from '../Credential.js';
import * as core_Mcp from '../Mcp.js';
import * as McpCredential from '../mcp/internal/Credential.js';
import * as Receipt from '../Receipt.js';
import * as Html from './internal/html/config.js';
import { serviceWorker } from './internal/html/serviceWorker.gen.js';
export { mcpSdk } from '../mcp/server/Transport.js';
/**
 * Creates a custom server-side transport.
 *
 * @example
 * ```ts
 * import { Transport } from 'mppx/server'
 *
 * const custom = Transport.from({
 *   name: 'custom',
 *   captureRequest(input) { ... },
 *   getCredential(input) { ... },
 *   respondChallenge({ challenge, input }) { ... },
 *   respondReceipt({ receipt, response, challengeId, credential, envelope, input }) { ... },
 * })
 * ```
 */
export function from(transport) {
    return transport;
}
/**
 * HTTP transport for server-side payment handling.
 *
 * - Reads credentials from the configured payment credential header
 * - Issues challenges via `WWW-Authenticate` header with 402 status
 * - Attaches receipts via `Payment-Receipt` header
 */
export function http(options = {}) {
    const credentialHeader = options.requiresAuth
        ? Constants.Headers.paymentAuthorization
        : Constants.Headers.authorization;
    return from({
        name: 'http',
        captureRequest(request) {
            return {
                hasBody: request.body !== null,
                headers: new Headers(request.headers),
                method: request.method,
                url: safeUrl(request.url),
            };
        },
        getCredential(request) {
            const header = request.headers.get(credentialHeader);
            if (!header)
                return null;
            const payment = Credential.extractPaymentScheme(header);
            if (!payment)
                return null;
            return Credential.deserialize(payment);
        },
        async respondChallenge(options) {
            const { challenge, error, input } = options;
            if (options.html && new URL(input.url).searchParams.has(Html.params.serviceWorker))
                return new Response(serviceWorker, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/javascript',
                        'Cache-Control': 'no-store',
                    },
                });
            const headers = {
                [Constants.Headers.wwwAuthenticate]: Challenge.serialize(challenge),
                'Cache-Control': 'no-store',
            };
            const body = await (async () => {
                if (options.html && input.headers.get('Accept')?.includes('text/html')) {
                    headers['Content-Type'] = 'text/html; charset=utf-8';
                    const { theme, text } = Html.resolveOptions(options.html);
                    const amount = await options.html.formatAmount(challenge.request);
                    const dataMap = {
                        [challenge.id]: {
                            label: challenge.method,
                            rootId: Html.ids.root,
                            formattedAmount: amount,
                            config: options.html.config,
                            challenge,
                            text,
                            theme,
                        },
                    };
                    return Html.render({
                        entries: [{ challenge, content: options.html.content }],
                        dataMap,
                        formattedAmount: amount,
                        text,
                        theme,
                    });
                }
                if (error) {
                    headers['Content-Type'] = 'application/problem+json';
                    return JSON.stringify(error.toProblemDetails(challenge.id));
                }
                return null;
            })();
            return new Response(body, { status: error?.status ?? 402, headers });
        },
        respondReceipt({ receipt, response }) {
            const headers = new Headers(response.headers);
            headers.set('Cache-Control', withPrivateCacheControl(headers.get('Cache-Control')));
            headers.set(Constants.Headers.paymentReceipt, Receipt.serialize(receipt));
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        },
    });
}
function withPrivateCacheControl(value) {
    if (!value)
        return 'private';
    const directives = value.split(',').map((directive) => directive.trim().toLowerCase());
    if (directives.includes('private'))
        return value;
    return `${value}, private`;
}
/**
 * MCP transport for server-side payment handling with raw JSON-RPC.
 *
 * - Reads credentials from `_meta["org.paymentauth/credential"]`
 * - Issues challenges via JSON-RPC error with code -32042/-32043
 * - Attaches receipts via `_meta["org.paymentauth/receipt"]`
 *
 * Use this transport when handling raw JSON-RPC messages directly.
 * For use with `@modelcontextprotocol/sdk`, use `mcpSdk()` instead.
 */
export function mcp() {
    return from({
        name: 'mcp',
        captureRequest(request) {
            return {
                // MCP tool invocations are application content requests even though
                // they do not carry HTTP body headers on the transport boundary.
                hasBody: true,
                headers: new Headers(),
                method: 'POST',
                url: new URL(`mcp://request/${encodeURIComponent(request.method ?? 'unknown')}`),
            };
        },
        getCredential(request) {
            const meta = request.params?._meta;
            const value = meta?.[core_Mcp.credentialMetaKey];
            if (value === undefined)
                return null;
            const parsed = McpCredential.parse(value);
            if (!parsed)
                throw new Credential.InvalidCredentialEncodingError();
            return parsed.value;
        },
        respondChallenge({ challenge, input, error }) {
            return {
                jsonrpc: '2.0',
                id: input.id,
                error: {
                    code: core_Mcp.errorCode(error),
                    message: error?.message ?? 'Payment Required',
                    data: {
                        httpStatus: error?.status ?? 402,
                        challenges: [challenge],
                        ...(error && { problem: error.toProblemDetails(challenge.id) }),
                    },
                },
            };
        },
        respondReceipt({ receipt, response, challengeId }) {
            if ('error' in response)
                return response;
            const mcpReceipt = {
                ...receipt,
                challengeId,
            };
            return {
                ...response,
                result: {
                    ...response.result,
                    _meta: {
                        ...response.result._meta,
                        [core_Mcp.receiptMetaKey]: mcpReceipt,
                    },
                },
            };
        },
    });
}
export function safeUrl(url) {
    try {
        if (url instanceof URL)
            return new URL(url.toString());
        if (url)
            return new URL(url);
    }
    catch { }
    return new URL('about:blank');
}
//# sourceMappingURL=Transport.js.map