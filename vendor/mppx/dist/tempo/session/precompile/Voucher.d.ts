import type { Account, Address, Client, Hex } from 'viem';
import type { Voucher, SignedVoucher } from './Protocol.js';
/**
 * EIP-712 domain for voucher signing.
 */
export declare function getVoucherDomain(escrowContract: Address, chainId: number): {
    readonly name: "TIP20 Channel Reserve";
    readonly version: "1";
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
};
/**
 * EIP-712 types for voucher signing.
 * Matches @tempo/stream-channels/voucher and on-chain VOUCHER_TYPEHASH.
 */
export declare const voucherTypes: {
    readonly Voucher: readonly [{
        readonly name: 'channelId';
        readonly type: 'bytes32';
    }, {
        readonly name: 'cumulativeAmount';
        readonly type: 'uint96';
    }];
};
/**
 * Sign a voucher with an account.
 */
export declare function signVoucher(client: Client, account: Account, voucher: Voucher, verifyingContract: Address, chainId: number): Promise<Hex>;
/**
 * Verify a voucher signature matches the expected signer.
 *
 * Accepts canonical TIP-1020 primitive signatures. Keychain wrappers,
 * multisig signatures, and magic-suffixed encodings are rejected.
 */
export declare function verifyVoucher(escrowContract: Address, chainId: number, voucher: SignedVoucher, expectedSigner: Address): boolean;
/**
 * Parse a voucher from credential payload.
 */
export declare function parseVoucherFromPayload(channelId: Hex, cumulativeAmount: string, signature: Hex): SignedVoucher;
//# sourceMappingURL=Voucher.d.ts.map