import type * as http from 'node:http';
import type * as http2 from 'node:http2';
/**
 * Writes a Fetch API `Response` to a Node.js `ServerResponse`.
 *
 * Useful when bridging Fetch API handlers with Node.js HTTP servers.
 */
export declare function sendResponse(res: http.ServerResponse | http2.Http2ServerResponse, response: Response): Promise<void>;
//# sourceMappingURL=NodeListener.d.ts.map