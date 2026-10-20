import type { Address } from 'viem';
import type { CrossChainRoute, EstimatedCrossChainQuote } from '../interfaces/cross-chain.js';
import type { EvmRoute } from '../interfaces/evm.js';
/** Narrow Privy SDK surface consumed by the adapters. */
export type PrivyClient = Readonly<{
    wallets(): Readonly<{
        swaps(): Readonly<{
            quote(walletId: string, parameters: PrivySwapParameters): Promise<PrivyQuoteResponse>;
            execute(walletId: string, parameters: PrivySwapParameters): Promise<PrivyAction>;
        }>;
        actions: Readonly<{
            get(actionId: string, parameters: Readonly<{
                wallet_id: string;
            }>): Promise<unknown>;
        }>;
    }>;
}>;
/**
 * Privy request authorization material passed directly to the SDK. Like the other request types
 * here, it mirrors the SDK's shape exactly, so optional fields do not accept `undefined`.
 */
export type PrivyAuthorizationContext = Readonly<{
    authorization_private_keys?: string[];
    user_jwts?: string[];
    signatures?: string[];
    sign_fns?: ((payload: Uint8Array) => Promise<string>)[];
}>;
/** Exact-output parameters shared by Privy quote and execution calls. */
export type PrivySwapParameters = Readonly<{
    base_amount: string;
    amount_type: 'exact_output';
    source: Readonly<{
        asset_address: string;
        caip2: string;
    }>;
    destination: Readonly<{
        asset_address: string;
        caip2: string;
        destination_address?: string;
    }>;
    slippage_bps: number;
    authorization_context?: PrivyAuthorizationContext;
    idempotency_key?: string;
}>;
/** Privy quote fields validated by machine-fetch. */
export type PrivyQuoteResponse = Readonly<{
    caip2: string;
    destination_caip2?: string;
    input_token: string;
    output_token: string;
    input_amount: string;
    est_output_amount: string;
    minimum_output_amount: string;
    expires_at?: number | undefined;
}>;
/** Privy wallet-action fields used for reconciliation and actual-spend reporting. */
export type PrivyAction = Readonly<{
    id: string;
    type: string;
    status: 'pending' | 'succeeded' | 'rejected' | 'failed';
    wallet_id: string;
    caip2: string;
    destination_caip2?: string;
    input_token: string;
    output_token: string;
    input_amount: string | null;
    output_amount: string | null;
}>;
/** Privy wallet identity used for signing and wallet actions. */
export type PrivyWallet = Readonly<{
    id: string;
    address: Address;
}>;
/** Configuration for Privy-managed swap routes. */
export type PrivyRouteOptions = Readonly<{
    client: PrivyClient;
    wallet: PrivyWallet;
    /** Privy signer authorization; retained privately and never copied into quotes or receipts. */
    authorizationContext?: PrivyAuthorizationContext | undefined;
    /** Status polling interval for same-chain swaps. @default 1000 */
    pollIntervalMs?: number | undefined;
}>;
/**
 * Creates an estimate-only, exact-output EVM route executed as a Privy wallet action. The request's
 * `operationId` is Privy's idempotency key, so retrying an operation resumes its action rather than
 * swapping again. Once Privy execution may have started, failures are `FundingRecoveryError`s for
 * the operation, with the wallet-action ID as `reference` when it is known.
 */
export declare function privyEvmRoute(options: PrivyRouteOptions): EvmRoute;
/**
 * Creates a resumable, estimate-only Privy route for cross-network exact-output funding. The
 * request ID is Privy's idempotency key, and every accepted wallet action, even a failed one, is
 * returned for persistence so its status is reconciled rather than resubmitted.
 */
export declare function privyCrossChainRoute(options: PrivyRouteOptions): CrossChainRoute<EstimatedCrossChainQuote>;
