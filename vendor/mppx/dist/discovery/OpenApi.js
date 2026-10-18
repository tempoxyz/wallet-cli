import * as PaymentRequest from '../PaymentRequest.js';
import { PaymentInfo } from './Discovery.js';
import * as Metadata from './internal/Metadata.js';
/**
 * Generates an OpenAPI 3.1.0 discovery document from an mppx instance
 * and route configuration.
 */
export function generate(mppx, config) {
    const methods = mppx.methods;
    const methodsByKey = new Map();
    const intentCount = {};
    for (const mi of methods) {
        methodsByKey.set(`${mi.name}/${mi.intent}`, mi);
        intentCount[mi.intent] = (intentCount[mi.intent] ?? 0) + 1;
    }
    for (const mi of methods) {
        if (intentCount[mi.intent] === 1)
            methodsByKey.set(mi.intent, mi);
    }
    const routes = config.routes.map((route) => resolveRoute(route, methodsByKey));
    return createDocument({
        info: {
            title: config.info?.title ?? mppx.realm,
            version: config.info?.version ?? '1.0.0',
        },
        routes,
        serviceInfo: config.serviceInfo,
    });
}
/**
 * Generates an OpenAPI 3.1.0 discovery document for a proxy surface.
 */
export function generateProxy(config) {
    const routes = config.routes.map((route) => ({
        ...route,
        path: withBasePath(config.basePath, route.path),
    }));
    return createDocument({
        info: {
            title: config.info?.title ?? 'API Proxy',
            version: config.info?.version ?? '1.0.0',
        },
        routes,
        serviceInfo: config.serviceInfo,
    });
}
function createDocument(config) {
    const paths = {};
    for (const route of config.routes) {
        const method = route.method.toLowerCase();
        const operation = {
            responses: {
                ...(route.payment ? { '402': { description: 'Payment Required' } } : {}),
                '200': { description: 'Successful response' },
            },
        };
        if (route.payment)
            operation['x-payment-info'] = PaymentInfo.parse(route.payment);
        if (route.summary)
            operation.summary = route.summary;
        if (route.requestBody)
            operation.requestBody = route.requestBody;
        if (!paths[route.path])
            paths[route.path] = {};
        paths[route.path][method] = operation;
    }
    const doc = {
        info: config.info,
        openapi: '3.1.0',
        paths,
    };
    if (config.serviceInfo)
        doc['x-service-info'] = config.serviceInfo;
    return doc;
}
function resolveRoute(route, methodsByKey) {
    if ('handler' in route) {
        const internal = route.handler._internal;
        if (!internal)
            throw new Error(`Route ${route.method.toUpperCase()} ${route.path} is missing discovery metadata`);
        return {
            method: route.method,
            path: route.path,
            payment: {
                offers: Metadata.offers(internal).map(Metadata.paymentOffer),
            },
            ...(route.requestBody ? { requestBody: route.requestBody } : {}),
            ...(route.summary ? { summary: route.summary } : {}),
        };
    }
    const mi = methodsByKey.get(route.intent);
    if (!mi) {
        throw new Error(`Unknown intent "${route.intent}" for route ${route.method.toUpperCase()} ${route.path}. Available: ${[...methodsByKey.keys()].join(', ')}`);
    }
    const { description, ...options } = route.options;
    const metadata = {
        _canonicalRequest: PaymentRequest.fromMethod(mi, options),
        ...(typeof description === 'string' ? { description } : {}),
        intent: mi.intent,
        name: mi.name,
    };
    return {
        method: route.method,
        path: route.path,
        payment: Metadata.paymentOffer(metadata),
        ...(route.requestBody ? { requestBody: route.requestBody } : {}),
        ...(route.summary ? { summary: route.summary } : {}),
    };
}
function withBasePath(basePath, path) {
    if (!basePath)
        return path;
    const normalizedBasePath = basePath.startsWith('/') ? basePath : `/${basePath}`;
    const trimmedBasePath = normalizedBasePath.endsWith('/')
        ? normalizedBasePath.slice(0, -1)
        : normalizedBasePath;
    return `${trimmedBasePath}${path}`;
}
//# sourceMappingURL=OpenApi.js.map