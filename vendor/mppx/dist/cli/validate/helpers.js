import { pc } from '../utils.js';
export function check(label, detail) {
    return detail ? { label, detail, severity: 'pass' } : { label, severity: 'pass' };
}
export function fail(label, detail, hint) {
    const r = { label, severity: 'fail' };
    if (detail)
        r.detail = detail;
    if (hint)
        r.hint = hint;
    return r;
}
export function warn(label, detail, hint) {
    const r = { label, severity: 'warn' };
    if (detail)
        r.detail = detail;
    if (hint)
        r.hint = hint;
    return r;
}
export function skip(label, detail, hint) {
    const r = detail ? { label, detail, severity: 'skip' } : { label, severity: 'skip' };
    if (hint)
        r.hint = hint;
    return r;
}
const SEVERITY_ICONS = {
    pass: pc.green('✓'),
    fail: pc.red('✗'),
    warn: pc.yellow('⚠'),
    suggested: pc.cyan('◇'),
    skip: pc.dim('○'),
};
export function printCheck(result) {
    const icon = SEVERITY_ICONS[result.severity];
    const text = result.detail ? `${result.label} (${result.detail})` : result.label;
    console.log(`  ${icon} ${text}`);
    if (result.hint && result.severity !== 'pass') {
        console.log(pc.dim(`    → ${result.hint}`));
    }
}
export function printSection(title) {
    console.log(`\n${pc.bold(title)}`);
}
export function printResults(results, counts) {
    for (const result of results) {
        printCheck(result);
        if (result.severity === 'pass')
            counts.passed++;
        else if (result.severity === 'fail')
            counts.failed++;
        else if (result.severity === 'warn')
            counts.warnings++;
        else if (result.severity === 'suggested')
            counts.suggested++;
        else if (result.severity === 'skip')
            counts.skipped++;
    }
}
export async function fetchWithTimeout(url, init, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
export const HTTP_METHODS = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'head',
    'options',
    'trace',
]);
export function isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}
export function isValidIntegerAmount(amount) {
    return typeof amount === 'string' && /^(0|[1-9][0-9]*)$/.test(amount);
}
export function parseEndpointArg(input) {
    const sep = input.indexOf(':');
    if (sep < 1)
        return null;
    const method = input.slice(0, sep).toLowerCase();
    if (!HTTP_METHODS.has(method))
        return null;
    const path = input.slice(sep + 1);
    if (!path)
        return null;
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return { method: method.toUpperCase(), path: normalizedPath };
}
// Resolves --body input: if JSON with all keys starting with /, it's a
// per-path mapping. Otherwise it's a global body for all endpoints.
export function resolveBodyForEndpoint(rawBody, endpointPath) {
    if (!rawBody)
        return undefined;
    try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const keys = Object.keys(parsed);
            if (keys.length > 0 && keys.every((k) => k.startsWith('/'))) {
                const value = parsed[endpointPath];
                if (value === undefined)
                    return undefined;
                return typeof value === 'string' ? value : JSON.stringify(value);
            }
        }
    }
    catch { }
    return rawBody;
}
export function parseHeaders(raw) {
    if (!raw)
        return {};
    const headers = {};
    for (const h of raw) {
        const idx = h.indexOf(':');
        if (idx > 0)
            headers[h.slice(0, idx).trim().toLowerCase()] = h.slice(idx + 1).trim();
    }
    return headers;
}
//# sourceMappingURL=helpers.js.map