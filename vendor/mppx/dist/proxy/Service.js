import * as Metadata from '../discovery/internal/Metadata.js';
/**
 * Creates a service definition.
 *
 * @example
 * ```ts
 * Service.from('my-api', {
 *   baseUrl: 'https://api.example.com',
 *   bearer: 'sk-...',
 *   routes: {
 *     'POST /v1/generate': mppx.charge({ amount: '0.01' }),
 *     'GET /v1/status': true,
 *   },
 * })
 * ```
 */
export function from(id, config) {
    const rewriteFromConfig = resolveRewriteRequest(config);
    return {
        baseUrl: config.baseUrl,
        categories: config.categories,
        description: config.description,
        docs: resolveDocs(config),
        id,
        onUpstreamError: config.onUpstreamError,
        routes: config.routes,
        title: config.title,
        rewriteRequest: config.rewriteRequest
            ? rewriteFromConfig
                ? async (req, ctx) => {
                    req = await rewriteFromConfig(req, ctx);
                    return config.rewriteRequest(req, ctx);
                }
                : config.rewriteRequest
            : rewriteFromConfig,
    };
}
export { from as custom };
function resolveRewriteRequest(config) {
    if (config.mutate) {
        const mutate = config.mutate;
        return (req, ctx) => {
            const options = ctx;
            const m = options.mutate ?? mutate;
            return m(req);
        };
    }
    if (config.bearer) {
        const bearer = config.bearer;
        return (req, ctx) => {
            const options = ctx;
            req.headers.set('Authorization', `Bearer ${options.bearer ?? bearer}`);
            return req;
        };
    }
    if (config.headers) {
        const headers = config.headers;
        return (req, ctx) => {
            const options = ctx;
            const h = options.headers ?? headers;
            for (const [name, value] of Object.entries(h))
                req.headers.set(name, value);
            return req;
        };
    }
    return undefined;
}
/** Renders an llms.txt markdown string for a list of services. */
export function toLlmsTxt(services, options) {
    const lines = [
        `# ${options?.title ?? 'API Proxy'}`,
        '',
        `> ${options?.description ?? 'Paid API proxy powered by [Machine Payments Protocol](https://mpp.tempo.xyz).'}`,
        '',
    ];
    if (services.length === 0)
        return lines.join('\n');
    lines.push('## Services', '');
    for (const s of services) {
        const label = s.title ?? s.id;
        const desc = s.description ? `: ${s.description}` : '';
        lines.push(`- ${label}${desc}`);
    }
    lines.push('', `[OpenAPI discovery](${options?.openApiPath ?? '/openapi.json'})`);
    return lines.join('\n');
}
/** Extracts per-endpoint options from an endpoint definition. */
export function getOptions(endpoint) {
    if (typeof endpoint === 'object' && endpoint !== null && 'options' in endpoint)
        return endpoint.options;
    return undefined;
}
/** Derives discovery payment metadata from an explicitly priced endpoint handler. */
export function paymentOf(endpoint) {
    if (endpoint === true)
        return null;
    const handler = typeof endpoint === 'function' ? endpoint : endpoint.pay;
    if (!('_internal' in handler))
        return null;
    const metadata = handler._internal;
    if (!metadata)
        return null;
    if (Metadata.isComposed(metadata))
        return { offers: Metadata.offers(metadata).map(Metadata.paymentOffer) };
    return Metadata.paymentOffer(metadata);
}
function resolveDocs(config) {
    if (config.docs) {
        return {
            ...config.docs,
            ...(config.docs.llms ? {} : { llms: resolveLlmsFromLegacy(config.docsLlmsUrl) }),
        };
    }
    const llms = resolveLlmsFromLegacy(config.docsLlmsUrl);
    return llms ? { llms } : undefined;
}
function resolveLlmsFromLegacy(input) {
    if (!input)
        return undefined;
    if (typeof input === 'string')
        return input;
    return input({}) ?? undefined;
}
//# sourceMappingURL=Service.js.map