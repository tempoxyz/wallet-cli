import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
export type FetchHandler = (request: Request) => Promise<Response> | Response;
export type RequestListenerOptions = {
    host?: string | undefined;
    onError?: ((error: unknown) => void | Response | Promise<void | Response>) | undefined;
    protocol?: string | undefined;
};
/**
 * Converts a Fetch API handler into a Node.js HTTP request listener.
 *
 * @param handler - A Fetch API handler: `(request: Request) => Response`.
 * @param options - Optional error handler.
 * @returns A Node.js `(req, res)` listener.
 */
export declare function toNodeListener(handler: FetchHandler, options?: RequestListenerOptions | undefined): RequestListener;
/**
 * Converts a Node.js `IncomingMessage`/`ServerResponse` pair to a Fetch API `Request`.
 *
 * @param req - The Node.js IncomingMessage.
 * @param res - The Node.js ServerResponse (used for abort signal lifecycle).
 * @returns A Fetch API Request.
 */
export declare function fromNodeListener(req: IncomingMessage, res: ServerResponse, options?: RequestListenerOptions | undefined): Request;
//# sourceMappingURL=Request.d.ts.map