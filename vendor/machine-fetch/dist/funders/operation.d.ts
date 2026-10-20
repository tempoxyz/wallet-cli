import { FundingRecoveryError } from '../core/errors.js';
import type { CrossChainOperation, CrossChainOperationStore, CrossChainRoute } from '../interfaces/cross-chain.js';
/** Terminal provider completion of a settled operation. */
export type Settlement = Readonly<{
    /** Provider submission reference, when one was returned now or saved earlier. */
    reference?: string;
    /** Actual source spend, when the provider reports it. */
    amountIn?: bigint;
}>;
/**
 * Submits only a newly claimed operation, then waits for provider completion. A claimed operation
 * that cannot be submitted (expired quote or cancellation) is released when the store supports it,
 * because nothing was broadcast; otherwise it stays claimed for reconciliation.
 */
export declare function settleOperation(options: Readonly<{
    operation: CrossChainOperation;
    route: CrossChainRoute;
    store: CrossChainOperationStore;
    signal: AbortSignal;
    submit: boolean;
    pollIntervalMs: number;
}>): Promise<Settlement>;
/** Funds may have moved for an operation; carries its provider reference when one is known. */
export declare function recoveryError(operationId: string, reference: string | undefined, options?: Readonly<{
    cause?: unknown;
    message?: string;
}>): FundingRecoveryError;
