import type * as Method from '../../../Method.js';
import type { SessionCredentialContext } from '../../session/precompile/Protocol.js';
/** Minimal immutable request shape used to decide whether a session request serves billable content. */
export type RequestBodyProbe = Pick<Method.CapturedRequest, 'headers' | 'hasBody' | 'method'> & Partial<Pick<Method.CapturedRequest, 'url'>>;
/** Captures the request fields needed by the session content/management classifier. */
export declare function captureRequestBodyProbe(input: Request): RequestBodyProbe;
/** Returns whether request metadata indicates a meaningful body is present. */
export declare function hasCapturedRequestBody(input: Pick<RequestBodyProbe, 'headers' | 'hasBody'>): boolean;
/** Returns whether a verified session credential should let the application handler serve content. */
export declare function isSessionContentRequest(input: RequestBodyProbe): boolean;
/** Returns whether a plain non-streaming response should be charged after verification. */
export declare function shouldChargePlainResponse(input: RequestBodyProbe, payload: Partial<SessionCredentialContext>): boolean;
//# sourceMappingURL=request-body.d.ts.map