import { type Address } from 'ox';
import type { Account, Client, Hex } from 'viem';
import type { LegacySignedVoucher, LegacyVoucher } from './Types.js';
/**
 * Sign a voucher with an account.
 */
export declare function signVoucher(client: Client, account: Account, message: LegacyVoucher, escrowContract: Address.Address, chainId: number, voucherSigner?: Account | undefined): Promise<Hex>;
/**
 * Verify a voucher signature matches the expected signer.
 *
 * Accepts canonical raw secp256k1 voucher signatures.
 *
 * TIP-1020 voucher signatures will be enabled when onchain escrow verification ships.
 */
export declare function verifyVoucher(escrowContract: Address.Address, chainId: number, voucher: LegacySignedVoucher, expectedSigner: Address.Address): Promise<boolean>;
/**
 * Parse a voucher from credential payload.
 */
export declare function parseVoucherFromPayload(channelId: Hex, cumulativeAmount: string, signature: Hex): LegacySignedVoucher;
//# sourceMappingURL=Voucher.d.ts.map