import { type Address, type Hex } from 'viem';
import type { BoundedCrossChainQuote, CrossChainOperation, CrossChainRequest, CrossChainStatus, EvmTokenAccount } from '../interfaces/cross-chain.js';
import type { EvmClient } from '../interfaces/evm.js';
import type { RelayApiQuote, RelayProtocolLimits } from './relay-protocol.js';
/** Viem clients by chain ID: the source client signs, every other client only reads. */
export type RelayClients = Readonly<Record<number, EvmClient>>;
/** A chain in Relay's registry: its protocol name and the depository that receives deposits. */
type RelayChain = Readonly<{
    name: string;
    depository: Address;
}>;
/** Looks up a chain in Relay's registry, fetched once per route. */
export type RelayChains = (chainId: number, signal: AbortSignal) => Promise<RelayChain>;
/** A source transaction reconstructed locally, never copied from provider calldata. */
type Call = Readonly<{
    to: Address;
    data: Hex;
    value: bigint;
    gas: bigint | undefined;
}>;
/** Shared configuration of the viem-backed defaults. */
export type RelayViem = Readonly<{
    clients: RelayClients;
    chains: RelayChains;
    fetch: typeof globalThis.fetch;
    url: string;
    useDepositAddress: boolean;
}>;
/** Validates clients by chain ID and returns a frozen copy. */
export declare function clientsOf(clients: unknown): RelayClients;
/** Reads Relay's chain registry lazily; a failed read is retried by the next lookup. */
export declare function relayChains(fetch: typeof globalThis.fetch, url: string): RelayChains;
/**
 * Verifies a quote's executable steps against the request and returns only locally reconstructed
 * calls. Contract deposits must carry an order whose recomputed ID, input, output, and refunds
 * match the request; deposit-address quotes must be one exact token transfer.
 */
export declare function relayCalls(viem: RelayViem, quote: RelayApiQuote, request: CrossChainRequest): Promise<readonly Call[]>;
/**
 * Default `guarantees`: verifies the steps, then bounds gas by twice the estimated cost of every
 * source transaction, priced in the asset the source chain charges.
 */
export declare function viemGuarantees(viem: RelayViem, { quote, request }: Readonly<{
    quote: RelayApiQuote;
    request: CrossChainRequest;
}>): Promise<RelayProtocolLimits>;
/**
 * Default `submit`: signs the reconstructed calls with the source client. Before each signature,
 * the prepared gas limit and fee cap must fit in the declared gas fee, so no signed transaction can
 * spend more than the quote allows. Tempo calls are one atomic transaction that expires with the
 * quote.
 */
export declare function viemSubmit(viem: RelayViem, { quote, limits, request, }: Readonly<{
    quote: RelayApiQuote;
    limits: RelayProtocolLimits;
    request: CrossChainRequest;
}>): Promise<{
    reference: string;
}>;
/**
 * Default `status`: reads Relay's intent status. Success also needs every reported destination
 * transaction to have a successful receipt when a destination client is configured.
 */
export declare function viemStatus(viem: Pick<RelayViem, 'clients' | 'fetch' | 'url'>, operation: CrossChainOperation<BoundedCrossChainQuote>, { signal }: Readonly<{
    signal: AbortSignal;
}>): Promise<CrossChainStatus>;
/** Reads an account's token balance on its chain, or its native balance for the zero address. */
export declare function viemBalance(clients: RelayClients, account: EvmTokenAccount): Promise<bigint>;
export {};
