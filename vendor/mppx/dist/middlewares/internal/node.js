/** Converts a parsed Node framework request into the Fetch request consumed by mppx core. */
export function toRequest(request) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined)
            continue;
        if (Array.isArray(value))
            for (const entry of value)
                headers.append(name, entry);
        else
            headers.set(name, value);
    }
    const body = request.method === 'GET' || request.method === 'HEAD' || request.body === undefined
        ? undefined
        : toBody(request.body);
    return new Request(request.url, {
        ...(body === undefined ? {} : { body }),
        headers,
        method: request.method,
    });
}
/** Preserves Fetch-compatible bodies and serializes parsed JSON values. */
function toBody(body) {
    if (typeof body === 'string' ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        body instanceof Blob ||
        body instanceof FormData ||
        body instanceof URLSearchParams ||
        body instanceof ReadableStream)
        return body;
    return JSON.stringify(body);
}
//# sourceMappingURL=node.js.map