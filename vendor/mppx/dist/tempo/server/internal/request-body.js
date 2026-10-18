/** Captures the request fields needed by the session content/management classifier. */
export function captureRequestBodyProbe(input) {
    return {
        headers: input.headers,
        hasBody: input.body !== null,
        method: input.method,
        url: new URL(input.url),
    };
}
/** Returns whether request metadata indicates a meaningful body is present. */
export function hasCapturedRequestBody(input) {
    if (input.headers.get('content-length') === '0' && !input.headers.has('transfer-encoding'))
        return false;
    if (hasBodyFramingHeaders(input))
        return true;
    if (input.hasBody === true)
        return true;
    return false;
}
function hasBodyFramingHeaders(input) {
    const contentLength = input.headers.get('content-length');
    return (contentLength !== null && contentLength !== '0') || input.headers.has('transfer-encoding');
}
function hasBodyIntentHeaders(input) {
    return hasBodyFramingHeaders(input) || input.headers.has('content-type');
}
/** Returns whether a verified session credential should let the application handler serve content. */
export function isSessionContentRequest(input) {
    if (input.method === 'HEAD')
        return false;
    if (input.method !== 'POST')
        return true;
    if (input.url?.search)
        return true;
    return hasCapturedRequestBody(input);
}
/** Returns whether a plain non-streaming response should be charged after verification. */
export function shouldChargePlainResponse(input, payload) {
    if (payload.action === 'close' || payload.action === 'topUp')
        return false;
    if ((payload.action === 'open' || payload.action === 'voucher') &&
        input.method === 'POST' &&
        !input.url?.search &&
        input.hasBody !== true &&
        !hasBodyIntentHeaders(input))
        return false;
    return isSessionContentRequest(input);
}
//# sourceMappingURL=request-body.js.map