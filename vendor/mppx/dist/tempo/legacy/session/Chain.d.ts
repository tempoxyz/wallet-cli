import { type Account, type Address, type Client, type Hex, type ReadContractReturnType } from 'viem';
import * as FeePayer from '../../internal/fee-payer.js';
import { escrowAbi } from './escrow.abi.js';
import type { LegacySignedVoucher } from './Types.js';
export { escrowAbi };
/**
 * On-chain channel state from the escrow contract.
 */
export type OnChainChannel = ReadContractReturnType<typeof escrowAbi, 'getChannel'>;
/**
 * Read channel state from the escrow contract.
 */
export declare function getOnChainChannel(client: Client, escrowContract: Address, channelId: Hex): Promise<OnChainChannel>;
/**
 * Verify a topUp by re-reading on-chain channel state.
 */
export declare function verifyTopUpTransaction(client: Client, escrowContract: Address, channelId: Hex, previousDeposit: bigint): Promise<{
    deposit: bigint;
}>;
/** Options for {@link settleOnChain}. */
export type SettleOptions = {
    candidateFeeTokens?: readonly Address[] | undefined;
    feePayer: Account;
    account: Account;
} | {
    candidateFeeTokens?: readonly Address[] | undefined;
    feePayer?: undefined;
    account?: Account | undefined;
};
/**
 * Submit a settle transaction on-chain.
 */
export declare function settleOnChain(client: Client, escrowContract: Address, voucher: LegacySignedVoucher, options?: SettleOptions): Promise<Hex>;
/** Options for {@link closeOnChain}. */
export type CloseOptions = {
    candidateFeeTokens?: readonly Address[] | undefined;
    feePayer: Account;
    account: Account;
} | {
    candidateFeeTokens?: readonly Address[] | undefined;
    feePayer?: undefined;
    account?: Account | undefined;
};
/**
 * Submit a close transaction on-chain.
 */
export declare function closeOnChain(client: Client, escrowContract: Address, voucher: LegacySignedVoucher, options?: CloseOptions): Promise<Hex>;
/** Result returned after a legacy open transaction is broadcast or recovered from on-chain state. */
export type BroadcastResult = {
    txHash: Hex | undefined;
    onChain: OnChainChannel;
};
/** Inputs for broadcasting and validating a legacy contract-backed open transaction. */
export type BroadcastOpenTransactionParameters = {
    beforeBroadcast?: ((onChain: OnChainChannel) => Promise<void> | void) | undefined;
    challengeExpires?: string | undefined;
    channelId: Hex;
    client: Client;
    currency: Address;
    escrowContract: Address;
    feePayer?: Account | undefined;
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    isSponsored?: boolean | undefined;
    recipient: Address;
    serializedTransaction: Hex;
    /** When false, simulates instead of waiting for confirmation and returns derived on-chain state. @default true */
    waitForConfirmation?: boolean | undefined;
};
/** Inputs for broadcasting and validating a legacy contract-backed top-up transaction. */
export type BroadcastTopUpTransactionParameters = {
    challengeExpires?: string | undefined;
    channelId: Hex;
    client: Client;
    currency: Address;
    declaredDeposit: bigint;
    escrowContract: Address;
    feePayer?: Account | undefined;
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    isSponsored?: boolean | undefined;
    previousDeposit: bigint;
    serializedTransaction: Hex;
};
/** Result returned after a legacy top-up transaction is broadcast and verified. */
export type BroadcastTopUpTransactionResult = {
    newDeposit: bigint;
    txHash: Hex;
};
export declare function broadcastOpenTransaction(parameters: BroadcastOpenTransactionParameters): Promise<BroadcastResult>;
export declare function broadcastTopUpTransaction(parameters: BroadcastTopUpTransactionParameters): Promise<BroadcastTopUpTransactionResult>;
//# sourceMappingURL=Chain.d.ts.map