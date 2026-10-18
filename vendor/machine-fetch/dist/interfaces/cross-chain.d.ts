import type { Address } from 'viem';
import type { MaybePromise } from './common.js';
import type { Funder, FundingReceipt } from './funder.js';
import type { AssetAmount, FundingPolicy } from './policy.js';
/** Canonical metadata for one account-held EVM asset used by a relay route. */
export type EvmAccount = Readonly<{
    account: Address;
    asset: Address;
    chainId: number;
    currency: string;
    decimals: number;
    network: `eip155:${number}`;
}>;
/** Inputs shared by every quote for one exact-output relay operation. */
export type CrossChainRequest = Readonly<{
    /** Exact destination shortfall in atomic units of the destination asset. */
    amountOut: bigint;
    /** Unix timestamp in seconds bounding the funding operation. */
    deadline: number;
    from: EvmAccount;
    maxSlippageBps: number;
    /**
     * Operation identity shared by quoting and execution: the attempt ID of the paid request, or the
     * explicit top-up ID. Use it as the provider idempotency key.
     */
    id: string;
    /** Cooperative cancellation signal; abort does not prove funds have not moved. */
    signal: AbortSignal;
    to: EvmAccount;
}>;
/** Fields every route-bound exact-output quote carries. */
export type CrossChainQuoteBase = Readonly<{
    /** Quoted input in atomic units of the source asset. */
    amountIn: bigint;
    /** Opaque provider-owned quote data; execution must independently validate it. */
    data?: unknown;
    /** Unix timestamp in seconds; an expired quote cannot execute. */
    expiresAt?: number;
    reference: string;
}>;
/** A fee maximum; included fees are already covered by maxAmountIn. */
export type CrossChainFee = AssetAmount & Readonly<{
    kind: 'provider' | 'gas';
    includedInAmountIn: boolean;
}>;
/** Executable delivery and spending guarantees, validated by the trusted route. */
export type BoundedCrossChainQuote = CrossChainQuoteBase & Readonly<{
    amountOut: bigint;
    minAmountOut: bigint;
    maxAmountIn: bigint;
    expiresAt: number;
    /** Complete maximum fees, including source gas and approval transactions. */
    fees: readonly CrossChainFee[];
}>;
/** Estimate-only quote for providers that bind slippage during their own execution. */
export type EstimatedCrossChainQuote = CrossChainQuoteBase & Readonly<{
    amountOut: bigint;
    minAmountOut: bigint;
    expiresAt: number;
}>;
/** Quote persisted for resumable bounded or provider-managed execution. */
export type CrossChainQuote = BoundedCrossChainQuote | EstimatedCrossChainQuote;
/** Durable identity and immutable funding intent saved before any submission. */
export type CrossChainOperation<quote extends CrossChainQuote = CrossChainQuote> = Readonly<{
    id: string;
    route: string;
    requirementKey: string;
    request: Omit<CrossChainRequest, 'signal'>;
    quote: quote;
    reference?: string;
}>;
/** Application-owned durable storage; claim must atomically insert only when absent. */
export type CrossChainOperationStore = Readonly<{
    get(id: string): MaybePromise<CrossChainOperation | undefined>;
    claim(operation: CrossChainOperation): MaybePromise<boolean>;
    /** Atomically attach a reference; reject attempts to replace a different reference. */
    setReference(id: string, reference: string): MaybePromise<void>;
    /**
     * Remove a claimed operation that was never submitted, so its ID can be retried with a fresh
     * quote. Must reject when a reference is attached. Without it, such operations stay claimed.
     */
    release?(id: string): MaybePromise<void>;
}>;
/** Provider state; only completed permits payment credential creation. */
export type CrossChainStatus = Readonly<{
    status: 'pending' | 'completed' | 'refunded' | 'actionRequired';
    /** Actual source spend when the provider reports it after completion. */
    amountIn?: bigint;
    /** Actual destination delivery when the provider reports it after completion. */
    amountOut?: bigint;
}>;
/**
 * Resumable relay integration. `bounded` routes (the default) must return
 * {@link BoundedCrossChainQuote} guarantees; `provider-managed` routes return estimates and are
 * ineligible under `maxFundingSpend`. Quotes are validated against the mode at runtime.
 */
export type CrossChainRoute<quote extends CrossChainQuote = CrossChainQuote> = Readonly<{
    name: string;
    executionMode?: 'bounded' | 'provider-managed';
    quote(request: CrossChainRequest): MaybePromise<quote>;
    /** Use request.id for provider idempotency and recovery, before broadcasting. */
    submit(input: Readonly<{
        quote: quote;
        request: CrossChainRequest;
    }>): MaybePromise<{
        reference: string;
    }>;
    /** Recover using operation.id/quote when submit returned no reference; never resubmit. */
    status(operation: CrossChainOperation<quote>, context: Readonly<{
        signal: AbortSignal;
    }>): MaybePromise<CrossChainStatus>;
}>;
/** Options for exact-output cross-network payment funding. */
export type CrossChainFundOptions = Readonly<{
    /** Read the destination balance independently of the relay; return atomic units. */
    balance(account: EvmAccount): MaybePromise<bigint>;
    from: EvmAccount;
    routes: readonly CrossChainRoute[];
    to: EvmAccount;
    /** Maximum simultaneous route quote calls. @default 4 */
    concurrency?: number;
    /** Maximum time allowed for one route quote. @default 10000 */
    timeoutMs?: number;
    /** Durable storage; atomic claims must survive process restarts. */
    operations: CrossChainOperationStore;
    /** Status polling interval. @default 1000 */
    pollIntervalMs?: number;
}>;
/** Explicit replenishment settings for the funder's configured destination account. */
export type EnsureBalanceOptions = Readonly<{
    minimum: bigint;
    target: bigint;
    /** Identity shared by quoting and execution; persist it to reconcile ambiguous submission. */
    operationId: string;
    policy?: FundingPolicy;
    signal?: AbortSignal;
}>;
/** Payment funding plus explicit, independently budgeted balance replenishment. */
export type CrossChainFunder = Funder & Readonly<{
    ensureBalance(options: EnsureBalanceOptions): Promise<FundingReceipt | undefined>;
    /** Reconciles an existing operation without quoting or submitting again. */
    recover(operationId: string, options?: Readonly<{
        signal?: AbortSignal;
        deadlineSeconds?: number;
    }>): Promise<FundingReceipt>;
}>;
//# sourceMappingURL=cross-chain.d.ts.map