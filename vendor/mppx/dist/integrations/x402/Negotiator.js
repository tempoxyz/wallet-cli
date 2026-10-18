import { decodePaymentRequiredHeader } from '@x402/core/http';
import { getFacilitatorResponseError, x402HTTPResourceServer } from '@x402/core/server';
import * as Constants from '../../Constants.js';
import * as Credential from '../../Credential.js';
import * as SecretKey from '../../server/internal/SecretKey.js';
import * as Types from '../../x402/Types.js';
import * as Evm from './Evm.js';
/** Creates the native MPP side of an x402 compatibility integration. */
export function create(config) {
    SecretKey.assert(config.secretKey);
    const httpServer = new x402HTTPResourceServer(config.server, config.routes);
    let initialization;
    async function initialize() {
        initialization ??= httpServer.initialize().catch((error) => {
            initialization = undefined;
            throw error;
        });
        await initialization;
    }
    async function negotiate(request, context) {
        if (!httpServer.requiresPayment(context))
            return { status: 'unprotected' };
        if (hasMppCredential(request) && getX402Credential(request))
            return {
                response: Response.json({ error: 'Send either an MPP credential or an x402 payment signature, not both.' }, { status: 400 }),
                status: 'handled',
            };
        try {
            await initialize();
            if (getX402Credential(request))
                return { status: 'x402' };
            const result = await httpServer.processHTTPRequest(withoutX402Credential(context), config.paywallConfig);
            if (result.type === 'no-payment-required')
                return { status: 'unprotected' };
            if (result.type !== 'payment-error')
                throw new Error(`Expected x402 payment response, received ${result.type}.`);
            const x402Response = responseFromInstructions(result.response);
            const paymentRequired = getPaymentRequired(result);
            const handler = paymentRequired
                ? Evm.createHandler({ config, context, paymentRequired })
                : undefined;
            if (!handler)
                return { response: x402Response, status: 'handled' };
            const { payment, skipHandlerResponse } = await handler(request);
            if (payment.status !== 402)
                return skipHandlerResponse
                    ? { response: payment.withReceipt(skipHandlerResponse), status: 'handled' }
                    : { status: 'paid', withReceipt: payment.withReceipt };
            const response = mergeChallenge(payment.challenge, x402Response);
            return { response, status: 'handled' };
        }
        catch (error) {
            const facilitatorError = getFacilitatorResponseError(error);
            if (!facilitatorError)
                throw error;
            return {
                response: Response.json({ error: facilitatorError.message }, { status: 502 }),
                status: 'handled',
            };
        }
    }
    return { httpServer, negotiate };
}
/** Reads a current or legacy x402 payment credential. */
export function getX402Credential(request) {
    return (request.headers.get(Types.paymentSignatureHeader) ??
        request.headers.get(Types.legacyPaymentSignatureHeader) ??
        undefined);
}
/** Converts a Fetch request to the context consumed by x402 core. */
export function createContext(request, body) {
    const paymentHeader = getX402Credential(request);
    return {
        adapter: new FetchAdapter(request, body),
        method: request.method,
        path: new URL(request.url).pathname,
        ...(paymentHeader ? { paymentHeader } : {}),
    };
}
function hasMppCredential(request) {
    const authorization = request.headers.get(Constants.Headers.authorization);
    return authorization ? Credential.extractPaymentScheme(authorization) !== null : false;
}
function withoutX402Credential(context) {
    const { paymentHeader: _, ...withoutCredential } = context;
    return withoutCredential;
}
function getPaymentRequired(result) {
    if (result.type !== 'payment-error')
        return undefined;
    const target = Types.paymentRequiredHeader.toLowerCase();
    const encoded = Object.entries(result.response.headers).find(([name]) => name.toLowerCase() === target)?.[1];
    return encoded ? decodePaymentRequiredHeader(encoded) : undefined;
}
function responseFromInstructions(instructions) {
    const headers = new Headers(instructions.headers);
    let body = null;
    if (instructions.body !== undefined) {
        if (instructions.isHtml || typeof instructions.body === 'string')
            body = String(instructions.body);
        else {
            body = JSON.stringify(instructions.body);
            if (!headers.has('Content-Type'))
                headers.set('Content-Type', 'application/json');
        }
    }
    return new Response(body, { headers, status: instructions.status });
}
function mergeChallenge(mpp, x402) {
    const headers = new Headers(x402.headers);
    const challenge = mpp.headers.get('WWW-Authenticate');
    if (challenge)
        headers.append('WWW-Authenticate', challenge);
    headers.set('Cache-Control', 'no-store');
    return new Response(x402.body, {
        headers,
        status: x402.status,
        statusText: x402.statusText,
    });
}
/** Fetch implementation used only by the MCP compatibility wrapper. */
class FetchAdapter {
    request;
    body;
    constructor(request, body) {
        this.request = request;
        this.body = body;
    }
    getAcceptHeader() {
        return this.request.headers.get('Accept') ?? '';
    }
    getHeader(name) {
        return this.request.headers.get(name) ?? undefined;
    }
    getBody() {
        return this.body;
    }
    getMethod() {
        return this.request.method;
    }
    getPath() {
        return new URL(this.request.url).pathname;
    }
    getQueryParam(name) {
        const values = new URL(this.request.url).searchParams.getAll(name);
        if (values.length === 0)
            return undefined;
        return values.length === 1 ? values[0] : values;
    }
    getQueryParams() {
        const parameters = {};
        for (const key of new URL(this.request.url).searchParams.keys()) {
            const values = new URL(this.request.url).searchParams.getAll(key);
            parameters[key] = values.length === 1 ? values[0] : values;
        }
        return parameters;
    }
    getUrl() {
        return this.request.url;
    }
    getUserAgent() {
        return this.request.headers.get('User-Agent') ?? '';
    }
}
//# sourceMappingURL=Negotiator.js.map