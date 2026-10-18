import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
/** Copies Fetch response headers to an Express response. */
export declare function copyHeaders(response: ExpressResponse, headers: Headers): void;
/** Sends a Fetch response through Express without changing its status, headers, or bytes. */
export declare function sendResponse(response: ExpressResponse, fetchResponse: Response): Promise<ExpressResponse<any, Record<string, any>>>;
/** Converts an Express parsed request into the Fetch request consumed by mppx core. */
export declare function toRequest(request: ExpressRequest): Request;
//# sourceMappingURL=express.d.ts.map