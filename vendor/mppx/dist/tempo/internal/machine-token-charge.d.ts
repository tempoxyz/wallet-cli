import type * as Hex from 'ox/Hex';
import { type Address, type Client } from 'viem';
type Call = {
    data?: Hex.Hex | undefined;
    to?: Address | undefined;
    value?: bigint | undefined;
};
type RouteCall = {
    data: Hex.Hex;
    to: Address;
};
type Route = {
    calls: readonly [RouteCall, RouteCall];
    settlementSender: Address;
    transfers: readonly [{
        amount: bigint;
        memo: Hex.Hex;
        recipient: Address;
    }];
};
type Transfer = {
    amount: bigint | string;
    memo?: string | undefined;
    recipient: Address;
};
/** Returns whether a first-party machine-token charge route is deployed on a chain. */
export declare function isSupported(chainId: number | undefined): boolean;
/** Returns whether a currency is the machine token for a supported chain. */
export declare function isMachineToken(parameters: {
    chainId: number | undefined;
    currency: Address;
}): boolean;
/** Resolves the canonical first-party settlement route for a compatible charge. */
export declare function getRoute(parameters: {
    chainId: number | undefined;
    currency: Address;
    transfers: readonly Transfer[];
}): Route | undefined;
/** Builds and simulates the first-party settlement route. */
export declare function findRoute(client: Client, parameters: {
    account: Address;
    chainId: number;
    currency: Address;
    transfers: readonly Transfer[];
}): Promise<Route | undefined>;
/** Matches an exact first-party settlement route. */
export declare function matchRoute(parameters: {
    calls: readonly Call[];
    chainId: number | undefined;
    currency: Address;
    transfers: readonly Transfer[];
}): Route | undefined;
/** Returns the trusted sender that settles the configured charge route on a chain. */
export declare function getSettlementSender(chainId: number | undefined): Address | undefined;
export {};
//# sourceMappingURL=machine-token-charge.d.ts.map