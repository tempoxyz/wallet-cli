/** Whether a value is a valid token decimal count. */
export declare function isTokenDecimals(value: number): boolean;
/** Whether a value is a 0x-prefixed 20-byte hex EVM address, ignoring checksum case. */
export declare function isEvmAddress(value: string): boolean;
/** Whether a network is a canonical CAIP-2 EVM chain, `eip155:<chainId>` without leading zeros. */
export declare function isEvmNetwork(network: string): network is `eip155:${number}`;
/**
 * Comparable form of an asset or account identifier on a network. EVM addresses on EVM networks
 * compare case-insensitively; every other identifier must match exactly.
 */
export declare function canonicalIdentifier<identifier extends string | undefined>(network: string, identifier: identifier): identifier;
/** Key identifying an asset on a network, consistent with {@link canonicalIdentifier}. */
export declare function assetKey(asset: Readonly<{
    network: string;
    asset: string;
}>): string;
/** Rejects attempt IDs that cannot identify a request. */
export declare function assertAttemptId(attemptId: unknown): asserts attemptId is string;
/** Rejects a payer that cannot identify a signing account. */
export declare function assertPayer(payer: unknown): asserts payer is string;
/** Whether an optional payer is `account`; EVM addresses compare case-insensitively. */
export declare function isPayer(payer: string | undefined, account: string): boolean;
/** Whether a value is a non-array object. */
export declare function isRecord(value: unknown): value is Readonly<Record<string, unknown>>;
/** Validates the shared optional quote settings of route-quoting funders. */
export declare function assertQuoteOptions(options: Readonly<{
    concurrency?: number | undefined;
    timeoutMs?: number | undefined;
}>): void;
/** Whether a value is a finite number greater than zero. */
export declare function isPositive(value: number): boolean;
//# sourceMappingURL=validate.d.ts.map