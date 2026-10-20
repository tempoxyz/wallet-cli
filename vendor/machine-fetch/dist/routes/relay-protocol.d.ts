import type { BoundedCrossChainQuote, CrossChainRequest, CrossChainRoute } from '../interfaces/cross-chain.js';
import type { EvmClient } from '../interfaces/evm.js';
/** Transaction fields returned in a Relay Protocol step. Execution must validate them before use. */
export type RelayTx = Readonly<Record<string, unknown>> & Readonly<{
    chainId?: number | undefined;
    data?: string | undefined;
    from?: string | undefined;
    /** Provider gas estimate; used only as an upper bound, never as the signed gas limit. */
    gas?: string | undefined;
    to?: string | undefined;
    value?: string | undefined;
}>;
/** One executable or checkable item in a Relay Protocol step. */
export type RelayItem = Readonly<Record<string, unknown>> & Readonly<{
    check?: (Readonly<Record<string, unknown>> & Readonly<{
        endpoint?: string | undefined;
        method?: string | undefined;
    }>) | undefined;
    data?: RelayTx | undefined;
    status?: string | undefined;
}>;
/** One Relay Protocol execution step. */
export type RelayStep = Readonly<Record<string, unknown>> & Readonly<{
    id?: string | undefined;
    items?: readonly RelayItem[] | undefined;
    kind?: string | undefined;
    requestId?: string | undefined;
    depositAddress?: string | undefined;
}>;
/** A source or destination amount in a Relay Protocol quote. */
export type RelayProtocolCurrencyAmount = Readonly<Record<string, unknown>> & Readonly<{
    /** Canonical decimal integer string in atomic units. */
    amount: string;
    currency: Readonly<Record<string, unknown>> & Readonly<{
        address: string;
        chainId: number;
    }>;
}>;
/**
 * A parsed Relay Protocol quote response. Typed fields are validated, and `details` matches the
 * request; other provider-specific fields are untrusted.
 */
export type RelayApiQuote = Readonly<Record<string, unknown>> & Readonly<{
    details: Readonly<Record<string, unknown>> & Readonly<{
        currencyIn: RelayProtocolCurrencyAmount;
        currencyOut: RelayProtocolCurrencyAmount;
        recipient: string;
        sender: string;
    }>;
    steps: readonly RelayStep[];
}>;
/** Executable spending bounds; `submit` enforces them against the signed wallet actions. */
export type RelayProtocolLimits = Pick<BoundedCrossChainQuote, 'maxAmountIn' | 'fees' | 'expiresAt'>;
/**
 * Relay Protocol route settings. With `clients`, the route signs, bounds, and tracks Relay steps
 * itself; each callback replaces one default, for custom signers or provider checks.
 */
export type RelayProtocolRouteOptions = Readonly<{
    /**
     * Viem clients by chain ID. The source chain's client signs as the `from` owner; the destination
     * chain's client confirms delivery receipts and reads balances. Required unless both
     * `guarantees` and `submit` are supplied.
     */
    clients?: Readonly<Record<number, EvmClient>> | undefined;
    /** Route name; set distinct names to configure several Relay endpoints. @default relay-protocol */
    name?: string | undefined;
    /** Relay API base URL. @default https://api.relay.link */
    url?: string | undefined;
    /** Fetch implementation override. @default globalThis.fetch */
    fetch?: typeof globalThis.fetch | undefined;
    /** Request a strict single-use deposit address; unsupported origins reject the quote. */
    useDepositAddress?: boolean | undefined;
    /**
     * Validate executable source debits, gas maxima, and quote validity before submission.
     * @default verifies the steps against a recomputed Relay order and bounds gas with the source client
     */
    guarantees?: ((input: Readonly<{
        quote: RelayApiQuote;
        request: CrossChainRequest;
    }>) => RelayProtocolLimits | Promise<RelayProtocolLimits>) | undefined;
    /**
     * Sign and submit the revalidated quote within the saved `limits`.
     * @default signs the verified steps with the source client, refusing any transaction whose gas could exceed `limits`
     */
    submit?: ((input: Readonly<{
        quote: RelayApiQuote;
        limits: RelayProtocolLimits;
        request: CrossChainRequest;
    }>) => {
        reference: string;
    } | Promise<{
        reference: string;
    }>) | undefined;
    /**
     * Recover via operation.quote.reference even when no submission reference was saved.
     * @default polls Relay's intent status and checks destination receipts with the destination client
     */
    status?: CrossChainRoute<BoundedCrossChainQuote>['status'] | undefined;
}>;
/**
 * Creates a resumable Relay route. Callbacks default to Viem implementations over `clients`; a
 * route with clients also reads balances for `CrossChainFunder.create`.
 */
export declare function relayProtocolRoute(options: RelayProtocolRouteOptions): CrossChainRoute<BoundedCrossChainQuote>;
