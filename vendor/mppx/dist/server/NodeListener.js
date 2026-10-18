/**
 * Writes a Fetch API `Response` to a Node.js `ServerResponse`.
 *
 * Useful when bridging Fetch API handlers with Node.js HTTP servers.
 */
export async function sendResponse(res, response) {
    const headers = {};
    for (const [key, value] of response.headers) {
        if (key in headers) {
            const existing = headers[key];
            if (Array.isArray(existing))
                existing.push(value);
            else
                headers[key] = [existing, value];
        }
        else {
            headers[key] = value;
        }
    }
    if ('req' in res && res.req?.httpVersionMajor === 1)
        res.writeHead(response.status, response.statusText, headers);
    else
        res.writeHead(response.status, headers);
    if (response.body != null && res.req?.method !== 'HEAD') {
        const reader = response.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (res.write(value) === false)
                    await new Promise((resolve) => {
                        res.once('drain', resolve);
                    });
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    res.end();
}
//# sourceMappingURL=NodeListener.js.map