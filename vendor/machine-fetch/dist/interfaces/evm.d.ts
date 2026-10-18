import type { Account, Address, Chain, Client, Transport } from 'viem';
import type { Token } from 'viem/tokens';
import type { MaybePromise } from './common.js';
/** Viem client shape accepted by EVM funders and routes. */
export type EvmClient = Client<Transport, Chain | undefined, Account | undefined>;
/** Chain-specific token metadata resolved from a Viem token definition. */
export type EvmToken = Readonly<{
    address: Address;
    decimals: number;
    currency?: string | undefined;
    name?: string | undefined;
    symbol?: string | undefined;
}>;
/** A trusted exact-output route quote. */
export type EvmQuote = Readonly<{
    /** Quoted input in atomic units of tokenIn. */
    amountIn: bigint;
    /** Unix timestamp in seconds after which the quote is invalid. */
    expiresAt?: number;
    /** Opaque route-owned quote data; execution must independently validate it. */
    data?: unknown;
}>;
/** Parameters used to quote an exact target amount. */
export type EvmQuoteRequest = Readonly<{
    /** Payer whose funds the route may spend. */
    account: Address;
    /** Attempt of the paid request being funded; a stable idempotency key for one acquisition. */
    attemptId: string;
    /** Exact shortfall to acquire in atomic units of tokenOut. */
    amountOut: bigint;
    chainId: number;
    client: EvmClient;
    /** Unix timestamp in seconds; execution must enforce this bound. */
    deadline: number;
    /** Maximum execution slippage from local policy, in basis points. */
    maxSlippageBps: number;
    signal: AbortSignal;
    tokenIn: EvmToken;
    tokenOut: EvmToken;
}>;
/** Parameters used to execute a previously returned quote. */
export type EvmExecuteRequest = EvmQuoteRequest & Readonly<{
    quote: EvmQuote;
    /** Maximum atomic input including slippage; bounded execution must enforce it. */
    maxAmountIn: bigint;
}>;
/** Trusted swap or acquisition integration configured entirely by the caller. */
export type EvmRoute = Readonly<{
    name: string;
    /** Omission requires execution to enforce maxAmountIn; provider-managed is estimate-only. */
    executionMode?: 'bounded' | 'provider-managed';
    quote(request: EvmQuoteRequest): MaybePromise<EvmQuote | undefined>;
    /** Report `amountIn` when actual spend is known; receipts otherwise carry only the quote. */
    execute(request: EvmExecuteRequest): MaybePromise<Readonly<{
        amountIn?: bigint;
        reference?: string;
    }> | undefined>;
}>;
/** Options for the Viem-backed EVM funder. */
export type EvmFundOptions = Readonly<{
    /** Trusted metadata for payment assets the server may request. */
    outputs: readonly Token[];
    /** Trusted funding assets the account may spend. */
    inputs: readonly Token[];
    /** Caller-trusted exact-output integrations; never populate from server metadata. */
    routes: readonly EvmRoute[];
    /** Resolve a client for the requested chain; undefined means unavailable. */
    client(chainId: number): MaybePromise<EvmClient | undefined>;
    /** Payer address override; defaults to the resolved client account. */
    account?: Address;
    /** Maximum simultaneous route quote calls. @default 4 */
    concurrency?: number;
    /** Maximum time allowed for one route quote. @default 10000 */
    timeoutMs?: number;
    /** Override ERC-20 balanceOf reads; return atomic units for the requested token. */
    balance?(parameters: Readonly<{
        client: EvmClient;
        account: Address;
        token: EvmToken;
    }>): MaybePromise<bigint>;
}>;
export type { BoundedCrossChainQuote, CrossChainFee, CrossChainFunder, CrossChainFundOptions, CrossChainOperation, CrossChainOperationStore, CrossChainQuote, CrossChainQuoteBase, CrossChainRequest, CrossChainRoute, CrossChainStatus, EnsureBalanceOptions, EstimatedCrossChainQuote, EvmAccount, } from './cross-chain.js';
//# sourceMappingURL=evm.d.ts.map