import * as Credential from '../../Credential.js';
import * as core_Mcp from '../../Mcp.js';
import * as Transport from '../../server/Transport.js';
import * as McpCredential from '../internal/Credential.js';
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
export function mcpSdk() {
    let McpErrorClass;
    return Transport.from({
        name: 'mcp-sdk',
        captureRequest() {
            return {
                // MCP tool invocations are application content requests even though
                // they do not carry HTTP body headers on the transport boundary.
                hasBody: true,
                headers: new Headers(),
                method: 'POST',
                url: new URL('mcp://request/sdk'),
            };
        },
        getCredential(extra) {
            const value = extra._meta?.[core_Mcp.credentialMetaKey];
            if (value === undefined)
                return null;
            const parsed = McpCredential.parse(value);
            if (!parsed)
                throw new Credential.InvalidCredentialEncodingError();
            return parsed.value;
        },
        async respondChallenge({ challenge, error }) {
            if (!McpErrorClass) {
                try {
                    const mod = await import('@modelcontextprotocol/sdk/types.js');
                    McpErrorClass = mod.McpError;
                }
                catch (error) {
                    const err = new Error('Missing optional dependency "@modelcontextprotocol/sdk". Install it to use mppx MCP SDK transports.');
                    err.cause = error;
                    throw err;
                }
            }
            return new McpErrorClass(core_Mcp.errorCode(error), error?.message ?? 'Payment Required', {
                httpStatus: error?.status ?? 402,
                challenges: [challenge],
                ...(error && { problem: error.toProblemDetails(challenge.id) }),
            });
        },
        respondReceipt({ receipt, response, challengeId }) {
            const mcpReceipt = {
                ...receipt,
                challengeId,
            };
            const normalizedResponse = response instanceof globalThis.Response
                ? { content: [] }
                : response;
            return {
                ...normalizedResponse,
                _meta: {
                    ...normalizedResponse._meta,
                    [core_Mcp.receiptMetaKey]: mcpReceipt,
                },
            };
        },
    });
}
//# sourceMappingURL=Transport.js.map