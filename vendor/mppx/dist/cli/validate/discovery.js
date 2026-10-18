import { check, fetchWithTimeout, HTTP_METHODS } from './helpers.js';
export async function fetchDiscoveryDoc(baseUrl) {
    // Trailing slash makes URL treat baseUrl as a directory, so relative resolution appends rather than replaces the last segment.
    const url = new URL('openapi.json', baseUrl.replace(/\/?$/, '/')).href;
    try {
        const response = await fetchWithTimeout(url, {});
        if (!response.ok)
            return { error: `HTTP ${response.status}` };
        const raw = await response.text();
        const doc = JSON.parse(raw);
        return { doc, raw };
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
            return { error: 'Request timed out after 15s' };
        if (error instanceof SyntaxError)
            return { error: 'Invalid JSON' };
        return { error: error.message };
    }
}
/** Checks that the server publishes nonempty text documentation at /llms.txt. */
export async function validateLlmsDoc(baseUrl) {
    const url = new URL('/llms.txt', baseUrl).href;
    const label = 'llms.txt found and nonempty';
    try {
        const response = await fetchWithTimeout(url, {});
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const body = (await response.text()).trim();
        if (!body)
            throw new Error('Empty document');
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if ((contentType && !contentType.startsWith('text/')) ||
            contentType === 'text/html' ||
            /^<(?:!doctype html|html|head|body)\b/i.test(body))
            throw new Error('Expected text documentation, received non-text or HTML content');
        return check(label, url);
    }
    catch (error) {
        return {
            label,
            detail: `${url}: ${error.message}`,
            severity: 'suggested',
            hint: 'Serve nonempty text documentation at /llms.txt.',
        };
    }
}
// Extracts testable endpoints from an OpenAPI doc. Prefers endpoints with
// explicit x-payment-info (the server declares them as paid). Falls back to
// endpoints that list a 402 response (weaker signal, but still worth testing).
export function extractEndpointsFromDiscovery(doc) {
    const withPaymentInfo = [];
    const with402Response = [];
    const paths = doc.paths;
    if (!paths)
        return [];
    for (const [pathKey, pathItem] of Object.entries(paths)) {
        const pathLevelParams = extractPathParameters(pathItem.parameters);
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method))
                continue;
            if (!operation || typeof operation !== 'object' || Array.isArray(operation))
                continue;
            const op = operation;
            const opParams = extractPathParameters(op.parameters);
            const merged = mergeParameters(pathLevelParams, opParams);
            const params = merged.length > 0 ? merged : undefined;
            if (op['x-payment-info']) {
                const payInfo = op['x-payment-info'];
                withPaymentInfo.push({
                    method: method.toUpperCase(),
                    path: pathKey,
                    amount: payInfo.amount,
                    parameters: params,
                });
            }
            else {
                const responses = op.responses;
                if (responses && '402' in responses) {
                    with402Response.push({ method: method.toUpperCase(), path: pathKey, parameters: params });
                }
            }
        }
    }
    return withPaymentInfo.length > 0 ? withPaymentInfo : with402Response;
}
export function extractRequestBodyFromDiscovery(doc, endpoint) {
    const paths = doc.paths;
    if (!paths)
        return undefined;
    const pathItem = paths[endpoint.path];
    if (!pathItem)
        return undefined;
    const op = pathItem[endpoint.method.toLowerCase()];
    if (!op?.requestBody)
        return undefined;
    const rb = op.requestBody;
    const content = rb.content;
    const jsonContent = content?.['application/json'];
    if (!jsonContent)
        return undefined;
    if (jsonContent.example)
        return JSON.stringify(jsonContent.example);
    if (jsonContent.examples && typeof jsonContent.examples === 'object') {
        const first = Object.values(jsonContent.examples)[0];
        if (first?.value)
            return JSON.stringify(first.value);
    }
    let schema = jsonContent.schema;
    const seen = new Set();
    schema = resolveRef(schema, doc, seen);
    if (!schema || schema.type !== 'object')
        return undefined;
    const result = generateValueFromSchema(schema, doc, seen);
    if (result && typeof result === 'object' && Object.keys(result).length > 0) {
        return JSON.stringify(result);
    }
    return undefined;
}
export function buildUrl(baseUrl, endpoint, query) {
    let path = endpoint.path;
    if (endpoint.parameters) {
        path = substitutePathParams(path, endpoint.parameters);
    }
    // Strip leading slash so URL resolves relative to baseUrl's path, not root.
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    let url = new URL(relativePath, baseUrl.replace(/\/?$/, '/')).href;
    if (query) {
        const u = new URL(url);
        for (const q of query) {
            const [key, ...rest] = q.split('=');
            if (key)
                u.searchParams.set(key, rest.join('='));
        }
        url = u.href;
    }
    return url;
}
// ── Internal helpers ─────────────────────────────────────────────────────────
function extractPathParameters(raw) {
    if (!Array.isArray(raw))
        return [];
    const results = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object')
            continue;
        const param = p;
        if (param.in !== 'path' || typeof param.name !== 'string')
            continue;
        results.push(param.schema && typeof param.schema === 'object'
            ? {
                name: param.name,
                in: 'path',
                schema: param.schema,
                example: param.example,
            }
            : { name: param.name, in: 'path', example: param.example });
    }
    return results;
}
function mergeParameters(base, override) {
    const merged = [...base];
    for (const p of override) {
        const idx = merged.findIndex((m) => m.name === p.name);
        if (idx >= 0)
            merged[idx] = p;
        else
            merged.push(p);
    }
    return merged;
}
function substitutePathParams(path, params) {
    return path.replace(/\{([^}]+)\}/g, (match, name) => {
        const param = params.find((p) => p.name === name && p.in === 'path');
        if (!param)
            return match;
        const value = param.example ?? param.schema?.example ?? param.schema?.default;
        if (value === undefined)
            return match;
        return encodeURIComponent(String(value));
    });
}
// Dereferences a JSON Schema $ref (e.g. "#/components/schemas/Foo") against the root doc.
function resolveRef(schema, doc, seen) {
    if (!schema || typeof schema.$ref !== 'string')
        return schema;
    if (seen?.has(schema.$ref))
        return undefined;
    const path = schema.$ref.replace(/^#\//, '').split('/');
    let resolved = doc;
    for (const segment of path) {
        if (resolved && typeof resolved === 'object')
            resolved = resolved[segment];
        else
            return undefined;
    }
    return resolved;
}
// Generates a plausible value for a JSON Schema node (required fields only for objects).
function generateValueFromSchema(schema, doc, seen) {
    const resolved = resolveRef(schema, doc, seen) ?? schema;
    if (resolved.const !== undefined)
        return resolved.const;
    if (resolved.example !== undefined)
        return resolved.example;
    if (resolved.default !== undefined)
        return resolved.default;
    switch (resolved.type) {
        case 'string': {
            if (resolved.enum && Array.isArray(resolved.enum))
                return resolved.enum[0];
            if (resolved.format === 'email')
                return 'test@example.com';
            if (resolved.format === 'uuid')
                return '00000000-0000-0000-0000-000000000000';
            if (resolved.format === 'uri' || resolved.format === 'url')
                return 'https://example.com';
            if (resolved.format === 'date')
                return '2026-01-01';
            if (resolved.pattern === '^\\d{5}(?:-\\d{4})?$')
                return '10001';
            if (resolved.pattern === '^[A-Z]{2}$')
                return 'US';
            return 'test';
        }
        case 'number':
        case 'integer':
            return resolved.minimum ?? 1;
        case 'boolean':
            return true;
        case 'array':
            return [];
        case 'object': {
            const properties = resolved.properties;
            if (!properties)
                return {};
            const required = resolved.required || [];
            const obj = {};
            for (const key of required) {
                const prop = properties[key];
                if (prop)
                    obj[key] = generateValueFromSchema(prop, doc, seen);
            }
            return obj;
        }
        default:
            return null;
    }
}
//# sourceMappingURL=discovery.js.map