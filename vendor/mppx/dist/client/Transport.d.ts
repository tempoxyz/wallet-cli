import * as Challenge from '../Challenge.js';
import * as Mcp from '../Mcp.js';
/**
 * Client-side transport adapter.
 *
 * Abstracts how challenges are received and credentials are sent
 * across different transport protocols (HTTP, MCP, etc.).
 */
export type Transport<in out request = unknown, in out response = unknown> = {
    /** Transport name for identification. */
    name: string;
    /**
     * Checks if a response indicates payment is required. May inspect the request (to gate
     * body reads) and be async (to read a response body).
     */
    isPaymentRequired: (response: response, request?: request) => boolean | Promise<boolean>;
    /** Extracts all challenges from a payment-required response. */
    getChallenges: (response: response, request?: request) => Challenge.Challenge[] | Promise<Challenge.Challenge[]>;
    /** Attaches a credential to a request. */
    setCredential: (request: request, credential: string, options?: setCredential.Options | undefined) => request;
};
export type AnyTransport = Transport<any, any>;
export declare namespace setCredential {
    type Options = {
        /** Challenge selected for credential creation. */
        challenge?: Challenge.Challenge | undefined;
    };
}
/** Extracts the response type from a transport. */
export type ResponseOf<transport extends Transport> = transport extends Transport<any, infer response> ? response : never;
/** Extracts the request type from a transport. */
export type RequestOf<transport extends Transport> = transport extends Transport<infer request, any> ? request : never;
/**
 * Creates a custom client-side transport.
 *
 * @example
 * ```ts
 * import { Transport } from 'mppx/client'
 *
 * const custom = Transport.from({
 *   name: 'custom',
 *   isPaymentRequired(response) { ... },
 *   getChallenges(response) { ... },
 *   setCredential(request, credential) { ... },
 * })
 * ```
 */
export declare function from<request, response>(transport: Transport<request, response>): Transport<request, response>;
/** HTTP transport that composes payment protocols while keeping `fetch` as the single boundary. */
export declare function http(): Transport<RequestInit, Response>;
/**
 * MCP protocol transport for direct JSON-RPC objects.
 *
 * Prefer {@link http} for MCP-over-HTTP fetches; this remains for callers that already operate on
 * parsed MCP request/response objects.
 */
export declare function mcp(): Transport<Mcp.Request, Mcp.Response>;
//# sourceMappingURL=Transport.d.ts.map