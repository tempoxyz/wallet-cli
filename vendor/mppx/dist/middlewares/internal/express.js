import * as NodeRequest from './node.js';
/** Copies Fetch response headers to an Express response. */
export function copyHeaders(response, headers) {
    for (const [name, value] of headers)
        response.setHeader(name, value);
}
/** Sends a Fetch response through Express without changing its status, headers, or bytes. */
export async function sendResponse(response, fetchResponse) {
    copyHeaders(response, fetchResponse.headers);
    response.status(fetchResponse.status);
    if (fetchResponse.body === null)
        return response.end();
    return response.send(Buffer.from(await fetchResponse.arrayBuffer()));
}
/** Converts an Express parsed request into the Fetch request consumed by mppx core. */
export function toRequest(request) {
    return NodeRequest.toRequest({
        body: request.body,
        headers: request.headers,
        method: request.method,
        url: `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    });
}
//# sourceMappingURL=express.js.map