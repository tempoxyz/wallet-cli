import type { AcquiredReceipt, AvailableReceipt } from '../interfaces/funder.js';
/** Receipt for a payment asset that was already held. */
export declare function availableReceipt(network: string, asset: string, amount: bigint): AvailableReceipt;
/** Receipt for an acquisition; `input.amount` appears only when actual spend was reported. */
export declare function acquiredReceipt(acquisition: Readonly<{
    route: string;
    input: Readonly<{
        network: string;
        asset: string;
        quotedAmount: bigint;
        amount?: bigint | undefined;
    }>;
    output: Readonly<{
        network: string;
        asset: string;
        amount: bigint;
    }>;
    reference?: string | undefined;
}>): AcquiredReceipt;
//# sourceMappingURL=receipt.d.ts.map