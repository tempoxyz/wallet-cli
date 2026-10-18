/** A human-readable payment ceiling. */
export type Money = Readonly<{
    /** Non-negative base-10 decimal string, without exponent notation. */
    amount: string;
    /** Reference currency matched case-insensitively against the payment metadata. */
    currency: string;
}>;
/** An atomic amount of one asset on one network. EVM addresses match case-insensitively. */
export type AssetAmount = Readonly<{
    network: string;
    asset: string;
    /** Non-negative amount in atomic units of asset. */
    amount: bigint;
}>;
/** Funding controls shared by payment funding and explicit balance replenishment. */
export type FundingPolicy = Readonly<{
    /** Per-funding-operation ceilings, including gas; every debited asset needs a limit. */
    maxFundingSpend?: readonly AssetAmount[];
    /** Restricts funding to matching reference currencies. Custom funders must enforce it. @default true */
    sameCurrencyOnly?: boolean;
    /** Maximum funding slippage, an integer from 0 to 10000 basis points. @default 100 */
    maxSlippageBps?: number;
    /** Funding deadline, an integer from 1 to 86400 seconds; not an HTTP/RPC timeout. @default 30 */
    deadlineSeconds?: number;
}>;
/** Safety policy applied before any payment credential is created. */
export type PaymentPolicy = FundingPolicy & Readonly<{
    /**
     * Per-payment ceiling; unset means no ceiling. A display amount rejects payments without
     * matching currency and decimals; asset amounts reject payments in any unlisted asset.
     */
    maxPayment?: Money | readonly AssetAmount[];
}>;
/** Fully resolved policy passed to funders; funding controls carry their defaults. */
export type ResolvedPaymentPolicy = Pick<PaymentPolicy, 'maxPayment' | 'maxFundingSpend'> & Required<Pick<PaymentPolicy, 'sameCurrencyOnly' | 'maxSlippageBps' | 'deadlineSeconds'>>;
//# sourceMappingURL=policy.d.ts.map