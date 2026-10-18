import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpError } from '@modelcontextprotocol/sdk/types.js';
import * as Challenge from '../../Challenge.js';
import * as AcceptPayment from '../../internal/AcceptPayment.js';
import * as core_Mcp from '../../Mcp.js';
import type * as Method from '../../Method.js';
import * as z from '../../zod.js';
type AnyClient = Method.Client<any, any>;
type Methods = readonly (Method.AnyClient | readonly Method.AnyClient[])[];
type DefaultMethods = readonly [Method.AnyClient | readonly Method.AnyClient[]];
type CallToolParams = Parameters<Client['callTool']>[0];
type CallToolResultSchema = Parameters<Client['callTool']>[1];
type CallToolRequestOptions = Parameters<Client['callTool']>[2];
type PaymentRequiredData = NonNullable<core_Mcp.ErrorObject['data']>;
export type OnPaymentRequired = (challenge: Challenge.Challenge) => boolean | Promise<boolean>;
/**
 * Result of a tool call with payment handling.
 * Extends the SDK's callTool return type with an optional payment receipt.
 */
export type CallToolResult = Awaited<ReturnType<Client['callTool']>> & {
    /** Payment receipt if payment was made. */
    receipt: core_Mcp.Receipt | undefined;
};
/**
 * Adds automatic payment handling to an MCP SDK client.
 *
 * The client's `callTool` method is replaced in place and the same reference
 * is returned, so surfaces that keep using the original client become
 * payment-aware — including when another SDK owns the client reference (e.g.
 * Cloudflare Agents). The MCP SDK `callTool(params, resultSchema?, options?)`
 * signature is preserved; pass a method's `context` or a per-call
 * `onPaymentRequired` approval hook via the options argument, where they are
 * stripped before the remaining request options are forwarded to the SDK.
 * Payment challenges are handled whether they arrive as payment-required
 * errors or as tool results carrying payment-required metadata. Calling
 * `wrap()` again replaces the payment configuration.
 *
 * @example
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client'
 * import { tempo } from 'mppx/client'
 * import { McpClient } from 'mppx/mcp/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = new Client({ name: 'my-client', version: '1.0.0' })
 * await client.connect(transport)
 *
 * McpClient.wrap(client, {
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Automatically handles payment challenges
 * const result = await client.callTool({ name: 'premium_tool', arguments: {} })
 * console.log(result.content, result.receipt)
 * ```
 */
export declare function wrap<const client extends Pick<Client, 'callTool'>, const methods extends Methods>(client: client, config: wrap.Config<methods>): wrap.McpClient<client, methods>;
export declare namespace wrap {
    type Config<methods extends Methods = Methods> = {
        /** Optional approval hook called before creating a payment credential. */
        onPaymentRequired?: OnPaymentRequired;
        /** Filters and sorts supported Challenges before Credential creation. */
        orderChallenges?: AcceptPayment.OrderChallenges<FlattenMethods<methods>> | undefined;
        /** Client-declared supported payment methods, keyed by typed `method/intent` strings. */
        paymentPreferences?: AcceptPayment.Config<FlattenMethods<methods>> | undefined;
        /** Array of methods to use. Accepts individual clients or tuples (e.g. from `tempo()`). */
        methods: methods;
    };
    type McpClient<client extends Pick<Client, 'callTool'> = Pick<Client, 'callTool'>, methods extends Methods = DefaultMethods> = Omit<client, 'callTool'> & {
        /** Call a tool with automatic payment handling. Preserves the MCP SDK signature. */
        callTool: (params: CallToolParams, resultSchema?: CallToolResultSchema, options?: CallToolOptions<methods>) => Promise<CallToolResult>;
    };
    type CallToolOptions<methods extends Methods = DefaultMethods> = CallToolRequestOptions & {
        /** Context to pass to the method intent's createCredential. */
        context?: AnyContextForMethods<methods>;
        /** Per-call approval hook; overrides the configured hook. Pass `null` to bypass it. */
        onPaymentRequired?: OnPaymentRequired | null;
    };
}
/**
 * Checks if an error is a payment required error.
 */
export declare function isPaymentRequiredError(error: unknown): error is McpError & {
    data: PaymentRequiredData;
};
/** Union of all context types from all methods that have context schemas. */
type AnyContextFor<methods extends readonly AnyClient[]> = {
    [key in keyof methods]: methods[key] extends Method.Client<any, infer context> ? context extends z.ZodMiniType ? z.input<context> : undefined : undefined;
}[number];
/** Union of all context types across a methods config, flattening tuples. @internal */
type AnyContextForMethods<methods extends Methods> = FlattenMethods<methods> extends infer flattened extends readonly AnyClient[] ? AnyContextFor<flattened> : never;
type FlattenMethods<methods extends Methods> = methods extends readonly [
    infer head,
    ...infer tail extends Methods
] ? head extends readonly Method.AnyClient[] ? readonly [...head, ...FlattenMethods<tail>] : head extends Method.AnyClient ? readonly [head, ...FlattenMethods<tail>] : never : readonly [];
export {};
//# sourceMappingURL=McpClient.d.ts.map