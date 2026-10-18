import * as NodeListener from './NodeListener.js';
/**
 * Converts a Fetch API handler into a Node.js HTTP request listener.
 *
 * @param handler - A Fetch API handler: `(request: Request) => Response`.
 * @param options - Optional error handler.
 * @returns A Node.js `(req, res)` listener.
 */
export function toNodeListener(handler, options) {
    const onError = options?.onError ??
        ((error) => {
            console.error(error);
            return new Response('Internal Server Error', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' },
            });
        });
    return (async (req, res) => {
        let response;
        try {
            const request = fromNodeListener(req, res, options);
            response = await handler(request);
        }
        catch (error) {
            try {
                response =
                    (await onError(error)) ??
                        new Response('Internal Server Error', {
                            status: 500,
                            headers: { 'Content-Type': 'text/plain' },
                        });
            }
            catch (innerError) {
                console.error(`There was an error in the error handler: ${innerError}`);
                response = new Response('Internal Server Error', {
                    status: 500,
                    headers: { 'Content-Type': 'text/plain' },
                });
            }
        }
        await NodeListener.sendResponse(res, response);
    });
}
/**
 * Converts a Node.js `IncomingMessage`/`ServerResponse` pair to a Fetch API `Request`.
 *
 * @param req - The Node.js IncomingMessage.
 * @param res - The Node.js ServerResponse (used for abort signal lifecycle).
 * @returns A Fetch API Request.
 */
export function fromNodeListener(req, res, options) {
    let controller = new AbortController();
    res.once('close', () => controller?.abort());
    res.once('finish', () => {
        controller = null;
    });
    const method = req.method ?? 'GET';
    const headers = createHeaders(req);
    const protocol = options?.protocol ??
        ('encrypted' in req.socket && req.socket.encrypted
            ? 'https:'
            : 'http:');
    const host = options?.host ??
        headers.get('Host') ??
        req.headers[':authority'] ??
        'localhost';
    const url = createRequestUrl(req.url, `${protocol}//${host}`);
    const init = {
        method,
        headers,
        signal: controller.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && hasBody(headers)) {
        init.body = new ReadableStream({
            start(c) {
                req.on('data', (chunk) => {
                    c.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
                });
                req.on('end', () => {
                    c.close();
                });
            },
        });
        init.duplex = 'half';
    }
    return new Request(url, init);
}
function hasBody(headers) {
    const contentLength = headers.get('content-length');
    return (contentLength !== null && contentLength !== '0') || headers.has('transfer-encoding');
}
/**
 * Builds the request `URL` from a request target and a trusted origin.
 *
 * Only the parsed `pathname`/`search` are copied onto the trusted origin, so
 * the target's authority can never override the host (protocol-relative,
 * `///`, backslash, absolute-form, or embedded-authority targets). Components
 * are copied onto a `URL` object rather than concatenated and re-parsed, since
 * a normalized path can itself begin with `//` and be read as an authority.
 */
function createRequestUrl(target, origin) {
    const url = new URL(origin);
    if (!target)
        return url;
    let parsed;
    try {
        parsed = new URL(target, 'http://mppx.invalid');
    }
    catch {
        throw new TypeError('Invalid request target');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new TypeError('Unsupported request target protocol');
    url.pathname = parsed.pathname;
    url.search = parsed.search;
    url.hash = '';
    return url;
}
function createHeaders(req) {
    const headers = new Headers();
    const raw = req.rawHeaders;
    for (let i = 0; i < raw.length; i += 2) {
        if (raw[i].startsWith(':'))
            continue;
        headers.append(raw[i], raw[i + 1]);
    }
    return headers;
}
//# sourceMappingURL=Request.js.map