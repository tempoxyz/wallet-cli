import * as Mcp from '../../../Mcp.js';
import type { Protocol } from './Protocol.js';
type CorePaymentRequiredData = NonNullable<Mcp.ErrorObject['data']>;
export type PaymentRequiredData = Pick<CorePaymentRequiredData, 'challenges'> & Partial<Pick<CorePaymentRequiredData, 'httpStatus' | 'problem'>>;
/** Extracts validated payment-required data from MCP errors or tool result metadata. */
export declare function paymentRequiredData(message: Mcp.Response | undefined): PaymentRequiredData | undefined;
/**
 * MCP-over-HTTP — remote MCP rides Streamable HTTP, so its challenge is a JSON-RPC `-32042` error
 * in a normal 200 body (often `text/event-stream`), and the credential rides back in `_meta`.
 */
export declare function mcp(): Protocol;
export {};
//# sourceMappingURL=Mcp.d.ts.map