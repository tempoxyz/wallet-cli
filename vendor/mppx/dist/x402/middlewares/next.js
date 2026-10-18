import { NextAdapter, paymentProxyFromHTTPServer, withX402FromHTTPServer } from '@x402/next';
import { NextResponse } from 'next/server.js';
import * as Negotiator from '../../integrations/x402/Negotiator.js';
/**
 * Adds MPP negotiation to the official x402 Next.js route wrapper.
 *
 * The official adapter retains ownership of route execution, cancellation,
 * extensions, and post-handler x402 settlement.
 */
export function mpp(handler, route, server, config) {
    return createHandler(handler, { '*': route }, server, config);
}
/** Creates a dual-protocol Next.js proxy handler backed by the official x402 proxy. */
export function mppProxy(routes, server, config) {
    const mpp = Negotiator.create({ ...config, routes, server });
    const x402 = paymentProxyFromHTTPServer(mpp.httpServer, config.paywallConfig, undefined, false);
    return async (request) => {
        const result = await mpp.negotiate(request, createContext(request));
        if (result.status === 'unprotected')
            return NextResponse.next();
        if (result.status === 'handled')
            return result.response;
        if (result.status === 'paid')
            return result.withReceipt(NextResponse.next());
        return x402(request);
    };
}
function createHandler(handler, routes, server, config) {
    const mpp = Negotiator.create({ ...config, routes, server });
    const argumentsByRequest = new WeakMap();
    const x402 = withX402FromHTTPServer(((request) => handler(request, ...argumentsByRequest.get(request))), mpp.httpServer, config.paywallConfig, undefined, false);
    return async (request, ...arguments_) => {
        const result = await mpp.negotiate(request, createContext(request));
        if (result.status === 'unprotected')
            return handler(request, ...arguments_);
        if (result.status === 'handled')
            return result.response;
        if (result.status === 'paid')
            return result.withReceipt(await handler(request, ...arguments_));
        argumentsByRequest.set(request, arguments_);
        try {
            return await x402(request);
        }
        finally {
            argumentsByRequest.delete(request);
        }
    };
}
function createContext(request) {
    const paymentHeader = Negotiator.getX402Credential(request);
    return {
        adapter: new NextAdapter(request),
        method: request.method,
        path: request.nextUrl.pathname,
        ...(paymentHeader ? { paymentHeader } : {}),
    };
}
//# sourceMappingURL=next.js.map