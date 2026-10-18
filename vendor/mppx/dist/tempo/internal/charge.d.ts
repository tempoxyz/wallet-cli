import type { Address } from 'viem';
export type Split = {
    amount: string;
    memo?: string | undefined;
    recipient: Address;
};
export type Transfer = {
    amount: string;
    memo?: string | undefined;
    recipient: Address;
};
export declare function getTransfers(request: {
    amount: string;
    methodDetails?: {
        memo?: string | undefined;
        splits?: readonly Split[] | undefined;
    };
    recipient: Address;
}): Transfer[];
//# sourceMappingURL=charge.d.ts.map