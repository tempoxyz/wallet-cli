import { PaymentPolicyError } from '../core/errors.js';
import type { PaymentRequirement } from '../interfaces/payment.js';
/** Fields shared by official and Mppx-translated x402 payment requirements. */
type X402Selection = Readonly<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    extra?: Readonly<Record<string, unknown>> | undefined;
}>;
/** Converts a selected x402 requirement to the common model, identically for every adapter. */
export declare function x402PaymentRequirement(selection: X402Selection, resource: string, x402Version: number): PaymentRequirement;
/**
 * Parses a challenged amount in atomic units. Mppx and x402 schemas type amounts as strings; only
 * the canonical decimal spelling is accepted, so one amount cannot be written two ways.
 */
export declare function parseAtomicAmount(value: unknown): bigint;
/** Returns a challenged network, rejecting EVM networks whose chain ID is not canonical. */
export declare function parseNetwork(network: string): string;
/** A malformed or unsupported server challenge. */
export declare function invalidPayment(message: string, cause?: unknown): PaymentPolicyError;
export {};
//# sourceMappingURL=shared.d.ts.map