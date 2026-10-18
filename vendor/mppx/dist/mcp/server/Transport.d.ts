import type { CallToolResult, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as Credential from '../../Credential.js';
import * as core_Mcp from '../../Mcp.js';
import * as Transport from '../../server/Transport.js';
/**
 * MCP SDK tool handler "extra" parameter.
 * Compatible with `@modelcontextprotocol/sdk` RequestHandlerExtra.
 */
export type Extra = {
    _meta?: {
        [core_Mcp.credentialMetaKey]?: Credential.Credential;
        [key: string]: unknown;
    } | undefined;
    [key: string]: unknown;
};
export type McpSdk = Transport.Transport<Extra, McpError, CallToolResult>;
/**
 * MCP SDK transport for server-side payment handling with `@modelcontextprotocol/sdk`.
 *
 * - Reads credentials from `_meta["org.paymentauth/credential"]`
 * - Maps payment errors to their specification-defined JSON-RPC codes
 * - Attaches receipts via `_meta["org.paymentauth/receipt"]` on tool results
 *
 * @example
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
 * import { Mppx, Transport } from 'mppx/server'
 *
 * const payment = Mppx.create({
 *   method: tempo(),
 *   secretKey: process.env.SECRET_KEY,
 *   transport: Transport.mcpSdk(),
 * })
 *
 * server.registerTool('premium', { description: '...' }, async (extra) => {
 *   const result = await payment.charge({ request: { ... } })(extra)
 *   if (result.status === 402) throw result.challenge
 *   return result.withReceipt({ content: [...] })
 * })
 * ```
 */
export declare function mcpSdk(): McpSdk;
//# sourceMappingURL=Transport.d.ts.map