import * as Challenge from '../Challenge.js';
import * as Credential from '../Credential.js';
import * as Errors from '../Errors.js';
import type { Distribute, MaybePromise, UnionToIntersection } from '../internal/types.js';
import * as core_Mcp from '../Mcp.js';
import type * as Method from '../Method.js';
import * as Receipt from '../Receipt.js';
import * as Html from './internal/html/config.js';
export { type McpSdk, mcpSdk } from '../mcp/server/Transport.js';
/**
 * Server-side transport adapter.
 *
 * Abstracts how challenges are issued and credentials are received
 * across different transport protocols (HTTP, MCP, etc.).
 */
export type Transport<in out input = unknown, in out challengeOutput = unknown, in receiptResponse = challengeOutput, out receiptOutput = receiptResponse> = {
    /** Transport name for identification. */
    name: string;
    /** Captures the transport request into an immutable verification snapshot. */
    captureRequest?: ((input: input) => MaybePromise<Method.CapturedRequest>) | undefined;
    /**
     * Rebinds a transport-native credential to the route challenge after request
     * normalization. Transports with non-Payment-auth wire formats can parse their
     * payload early, then attach the canonical mppx challenge here.
     */
    bindCredential?: ((options: {
        challenge: Challenge.Challenge;
        credential: Credential.Credential;
        input: input;
    }) => MaybePromise<Credential.Credential>) | undefined;
    /**
     * Extracts credential from the transport input.
     * Returns `null` if no credential was provided, or throws if malformed.
     */
    getCredential: (input: input) => Credential.Credential | null;
    /** Creates a transport response for a payment challenge. */
    respondChallenge: (options: {
        challenge: Challenge.Challenge;
        error?: Errors.PaymentError | undefined;
        html?: Html.Options | undefined;
        input: input;
    }) => challengeOutput | Promise<challengeOutput>;
    /** Attaches a receipt to a successful response. */
    respondReceipt: (options: {
        challengeId: string;
        credential: Credential.Credential;
        envelope?: Method.VerifiedChallengeEnvelope | undefined;
        input: input;
        receipt: Receipt.Receipt;
        response: receiptResponse;
    }) => receiptOutput;
};
export type AnyTransport = Transport<any, any, any, any>;
export type Http = Transport<Request, Response>;
export type Mcp = Transport<core_Mcp.JsonRpcRequest, core_Mcp.Response>;
export type Sse<stream = any> = Transport<Request, Response, Response | AsyncIterable<string> | ((stream: stream) => AsyncIterable<string>), Response>;
/** Extracts the input type from a transport. */
export type InputOf<transport extends AnyTransport = AnyTransport> = transport extends Transport<infer input, any, any> ? input : never;
/** Extracts the challenge output type from a transport. */
export type ChallengeOutputOf<transport extends AnyTransport = AnyTransport> = transport extends Transport<any, infer challengeOutput, any> ? challengeOutput : never;
/** Extracts the receipt output type from a transport. */
export type ReceiptResponseOf<transport extends AnyTransport = AnyTransport> = transport extends Transport<any, any, infer response, any> ? response : never;
/** Extracts the resolved receipt type (return type of respondReceipt). */
export type ReceiptOutputOf<transport extends AnyTransport = AnyTransport> = transport extends Transport<any, any, any, infer output> ? output : never;
/**
 * The `withReceipt` overload set for a given transport.
 *
 * Produces one overload per union member of `ReceiptOutputOf<transport>`,
 * so TypeScript can contextually type generator function parameters.
 */
export type WithReceipt<transport extends AnyTransport = Http> = WithReceiptOverloads<transport>;
/**
 * Creates a custom server-side transport.
 *
 * @example
 * ```ts
 * import { Transport } from 'mppx/server'
 *
 * const custom = Transport.from({
 *   name: 'custom',
 *   captureRequest(input) { ... },
 *   getCredential(input) { ... },
 *   respondChallenge({ challenge, input }) { ... },
 *   respondReceipt({ receipt, response, challengeId, credential, envelope, input }) { ... },
 * })
 * ```
 */
export declare function from<input = unknown, challengeOutput = unknown, receiptOutput = challengeOutput, receiptResolved = receiptOutput>(transport: Transport<input, challengeOutput, receiptOutput, receiptResolved>): Transport<input, challengeOutput, receiptOutput, receiptResolved>;
/**
 * HTTP transport for server-side payment handling.
 *
 * - Reads credentials from the configured payment credential header
 * - Issues challenges via `WWW-Authenticate` header with 402 status
 * - Attaches receipts via `Payment-Receipt` header
 */
export declare function http(options?: http.Options): Http;
export declare namespace http {
    type Options = {
        /** Uses `Payment-Authorization` for Payment credentials so `Authorization` remains available for application authentication. */
        requiresAuth?: boolean | undefined;
    };
}
/**
 * MCP transport for server-side payment handling with raw JSON-RPC.
 *
 * - Reads credentials from `_meta["org.paymentauth/credential"]`
 * - Issues challenges via JSON-RPC error with code -32042/-32043
 * - Attaches receipts via `_meta["org.paymentauth/receipt"]`
 *
 * Use this transport when handling raw JSON-RPC messages directly.
 * For use with `@modelcontextprotocol/sdk`, use `mcpSdk()` instead.
 */
export declare function mcp(): Transport<core_Mcp.JsonRpcRequest, core_Mcp.Response, core_Mcp.Response, core_Mcp.Response>;
export declare function safeUrl(url: string | URL | undefined): URL;
/** @internal Distributes over the receipt response union to create overloads. */
type WithReceiptOverloads<transport extends AnyTransport = Http> = {
    (): ReceiptOutputOf<transport>;
} & UnionToIntersection<Distribute<ReceiptResponseOf<transport>, ReceiptOutputOf<transport>>>;
//# sourceMappingURL=Transport.d.ts.map