import type { MaybePromise } from '../interfaces/common.js';
import type { BoundedCrossChainQuote, CrossChainRequest, CrossChainRoute } from '../interfaces/cross-chain.js';
/** Transaction fields returned in a Relay Protocol step. Execution must validate them before use. */
type RelayTx = Readonly<Record<string, unknown>> & Readonly<{
    chainId?: number;
    data?: string;
    from?: string;
    to?: string;
    value?: string;
}>;
/** One executable or checkable item in a Relay Protocol step. */
type RelayItem = Readonly<Record<string, unknown>> & Readonly<{
    check?: Readonly<Record<string, unknown>> & Readonly<{
        endpoint?: string;
        method?: string;
    }>;
    data?: RelayTx;
    status?: string;
}>;
/** One Relay Protocol execution step. */
type RelayStep = Readonly<Record<string, unknown>> & Readonly<{
    id?: string;
    items?: readonly RelayItem[];
    kind?: string;
    requestId?: string;
    depositAddress?: string;
}>;
/** A source or destination amount in a Relay Protocol quote. */
type RelayProtocolCurrencyAmount = Readonly<Record<string, unknown>> & Readonly<{
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
/** Executable spending bounds; `submit` must enforce them against the signed wallet actions. */
export type RelayProtocolLimits = Pick<BoundedCrossChainQuote, 'maxAmountIn' | 'fees' | 'expiresAt'>;
/** Provider endpoint and quote settings. */
type RelayQuoteOptions = Readonly<{
    /** Route name; set distinct names to configure several Relay endpoints. @default relay-protocol */
    name?: string;
    /** Relay API base URL. @default https://api.relay.link */
    url?: string;
    /** Fetch implementation override. @default globalThis.fetch */
    fetch?: typeof globalThis.fetch;
    /** Request a strict single-use deposit address; unsupported origins reject the quote. */
    useDepositAddress?: boolean;
}>;
/** Wallet-owned spending bounds and recoverable execution for Relay Protocol. */
export type RelayProtocolOptions = RelayQuoteOptions & Readonly<{
    /** Validate executable source debits, gas maxima, and quote validity before submission. */
    guarantees(input: Readonly<{
        quote: RelayApiQuote;
        request: CrossChainRequest;
    }>): MaybePromise<RelayProtocolLimits>;
    /** Sign and submit the revalidated quote within the saved `limits`. */
    submit(input: Readonly<{
        quote: RelayApiQuote;
        limits: RelayProtocolLimits;
        request: CrossChainRequest;
    }>): MaybePromise<{
        reference: string;
    }>;
    /** Recover via operation.quote.reference even when no submission reference was saved. */
    status: CrossChainRoute<BoundedCrossChainQuote>['status'];
}>;
/** Creates a resumable Relay route with application-supplied signing and status lookup. */
export declare function relayProtocol(options: RelayProtocolOptions): CrossChainRoute<BoundedCrossChainQuote>;
export {};
//# sourceMappingURL=relay-protocol.d.ts.map