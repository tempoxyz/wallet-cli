import type { Account, Address, Client, Hex } from 'viem';
import { parseEventLogs } from 'viem';
import { sendRawTransaction } from 'viem/actions';
import { Transaction } from 'viem/tempo';
import * as FeePayer from '../../internal/fee-payer.js';
import type { ChannelDescriptor } from './Channel.js';
/** Minimal on-chain state read back after precompile transaction receipts. */
export type ReceiptValidationChannelState = {
    /** Cumulative amount settled on-chain. */
    settled: bigint;
    /** Current on-chain channel deposit. */
    deposit: bigint;
    /** Close-request timestamp, or zero when open. */
    closeRequestedAt: number;
};
/** Inputs used to validate a ChannelOpened event against the verified open calldata. */
export type ValidateChannelOpenedReceiptParameters = {
    /** Chain ID used in descriptor-derived channel ID. */
    chainId: number;
    /** Descriptor reconstructed from the open calldata. */
    descriptor: ChannelDescriptor;
    /** Channel ID emitted by the ChannelOpened event. */
    emittedChannelId: Hex;
    /** Deposit emitted by the ChannelOpened event. */
    emittedDeposit: bigint;
    /** Expiring nonce hash emitted by the ChannelOpened event. */
    emittedExpiringNonceHash: Hex;
    /** Escrow precompile address used in descriptor-derived channel ID. */
    escrow: Address;
    /** Channel ID expected from the credential. */
    expectedChannelId: Hex;
    /** Deposit parsed from open calldata. */
    openDeposit: bigint;
};
/** Inputs used to validate open read-back state after ChannelOpened. */
export type ValidateOpenReadbackStateParameters = {
    /** Deposit emitted by the ChannelOpened event. */
    emittedDeposit: bigint;
    /** State read back from the precompile. */
    state: ReceiptValidationChannelState;
};
/** Inputs used to validate a TopUp event against the credential channel ID. */
export type ValidateTopUpReceiptParameters = {
    /** Channel ID emitted by the TopUp event. */
    emittedChannelId: Hex;
    /** Channel ID expected from the credential. */
    expectedChannelId: Hex;
};
/** Inputs used to validate top-up read-back state after TopUp. */
export type ValidateTopUpReadbackStateParameters = {
    /** New deposit emitted by the TopUp event. */
    newDeposit: bigint;
    /** State read back from the precompile. */
    state: ReceiptValidationChannelState;
};
/** Typed fields decoded from a ChannelOpened receipt event. */
export type ChannelOpenedReceiptFields = {
    /** Channel ID emitted by the precompile. */
    channelId: Hex;
    /** Deposit emitted by the precompile. */
    deposit: bigint;
    /** Expiring nonce hash emitted by the precompile. */
    expiringNonceHash: Hex;
};
/** Typed fields decoded from a TopUp receipt event. */
export type TopUpReceiptFields = {
    /** Channel ID emitted by the precompile. */
    channelId: Hex;
    /** New total deposit emitted by the precompile. */
    newDeposit: bigint;
};
/** Typed fields decoded from a Settled receipt event. */
export type SettledReceiptFields = {
    /** New cumulative amount settled on-chain. */
    newSettled: bigint;
};
/** Typed fields decoded from a ChannelClosed receipt event. */
export type ChannelClosedReceiptFields = {
    /** Amount captured by the payee. */
    settledToPayee: bigint;
    /** Amount refunded to the payer. */
    refundedToPayer: bigint;
};
type ReceiptEventWithArgs = {
    args: Record<string, unknown>;
};
/** Reads and validates typed fields from a ChannelOpened receipt event. */
export declare function readChannelOpenedReceiptFields(event: ReceiptEventWithArgs): ChannelOpenedReceiptFields;
/** Reads and validates typed fields from a TopUp receipt event. */
export declare function readTopUpReceiptFields(event: ReceiptEventWithArgs): TopUpReceiptFields;
/** Reads and validates typed fields from a Settled receipt event. */
export declare function readSettledReceiptFields(event: ReceiptEventWithArgs): SettledReceiptFields;
/** Reads and validates typed fields from a ChannelClosed receipt event. */
export declare function readChannelClosedReceiptFields(event: ReceiptEventWithArgs): ChannelClosedReceiptFields;
/** Validates that ChannelOpened receipt fields match calldata, descriptor, and credential. */
export declare function validateChannelOpenedReceipt(parameters: ValidateChannelOpenedReceiptParameters): void;
/** Validates the state read back after a successful open transaction. */
export declare function validateOpenReadbackState(parameters: ValidateOpenReadbackStateParameters): void;
/** Validates that a TopUp receipt belongs to the credential channel. */
export declare function validateTopUpReceipt(parameters: ValidateTopUpReceiptParameters): void;
/** Validates the state read back after a successful top-up transaction. */
export declare function validateTopUpReadbackState(parameters: ValidateTopUpReadbackStateParameters): void;
/** Fee fields produced by viem transaction preparation for direct precompile calls. */
export type PreparedPrecompileFeePayerTransaction = {
    /** Estimated gas units for the transaction. */
    gas?: bigint | undefined;
    /** Maximum fee per gas unit. */
    maxFeePerGas?: bigint | undefined;
    /** Maximum priority fee per gas unit. */
    maxPriorityFeePerGas?: bigint | undefined;
};
/** Parameters for checking a direct precompile transaction against sponsor limits. */
export type AssertPrecompileFeePayerPolicyParameters = {
    /** Prepared transaction fee fields to validate. */
    prepared: PreparedPrecompileFeePayerTransaction;
    /** Optional sponsor policy overrides. Missing fields are not enforced here. */
    policy?: Partial<FeePayer.Policy> | undefined;
};
/** Enforces sponsor gas and fee limits before co-signing a direct precompile call. */
export declare function assertPrecompileFeePayerPolicy(parameters: AssertPrecompileFeePayerPolicyParameters): void;
/** viem client shape accepted by raw Tempo transaction actions. */
export type TransactionClient = Parameters<typeof sendRawTransaction>[0];
/**
 * On-chain channel state from the TIP20EscrowChannel precompile.
 */
export type ChannelState = {
    settled: bigint;
    deposit: bigint;
    closeRequestedAt: number;
};
/**
 * On-chain channel descriptor and state from the TIP20EscrowChannel precompile.
 */
export type Channel = {
    descriptor: ChannelDescriptor;
    state: ChannelState;
};
/**
 * Read channel descriptor and state from the TIP20EscrowChannel precompile.
 */
export declare function getChannel(client: Client, descriptor: ChannelDescriptor, escrow?: Address, blockNumber?: bigint): Promise<Channel>;
/**
 * Read channel state from the TIP20EscrowChannel precompile.
 */
export declare function getChannelState(client: Client, channelId: Hex, escrow?: Address, blockNumber?: bigint): Promise<ChannelState>;
/**
 * Read channel states from the TIP20EscrowChannel precompile.
 */
export declare function getChannelStatesBatch(client: Client, channelIds: readonly Hex[], escrow?: Address): Promise<ChannelState[]>;
/** Tuning for {@link readbackWithRetry}. */
export type ReadbackRetryOptions = {
    /** Additional attempts after the first, before giving up. @default 5 */
    retries?: number | undefined;
    /** Delay between attempts, in milliseconds. @default 250 */
    delayMs?: number | undefined;
};
/**
 * Retry an on-chain readback that is pinned to the block containing a just-sent
 * transaction.
 *
 * The escrow state read is served by a load-balanced RPC whose replicas can lag
 * behind the block that produced the transaction receipt. Callers pin the read
 * to that block number (via the `blockNumber` arg on {@link getChannel} /
 * {@link getChannelState}) so a node that has imported the block returns
 * authoritative state; replicas that have not yet imported it throw (e.g.
 * "header not found"), so we retry with a short backoff until one catches up.
 *
 * This closes the read-after-write race behind
 * `on-chain channel state does not match open receipt` — without it, a stale
 * `latest` read on a lagging replica returns an empty channel and fails
 * verification even though the open transaction succeeded.
 */
export declare function readbackWithRetry<T>(read: () => Promise<T>, options?: ReadbackRetryOptions): Promise<T>;
/** Options accepted by low-level TIP-1034 on-chain management helpers. */
export type ChannelTransactionOptions = {
    /** Account used to send the transaction when the viem client has no default account. */
    account?: Account | undefined;
    /** Candidate fee tokens used when resolving a fee token for fee-sponsored transactions. */
    candidateFeeTokens?: readonly Address[] | undefined;
    /** Fee-payer account, or `true` when the client transport uses a configured hosted fee-payer service. */
    feePayer?: Account | true | undefined;
    /** Optional fee-payer gas and total-fee limits enforced before co-signing. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Explicit fee token for the transaction. */
    feeToken?: Address | undefined;
};
/** Simulates an unsponsored client-signed session transaction without broadcasting it. */
export declare function simulateCredentialTransaction(parameters: {
    /** viem client used for the read-only execution simulation. */
    client: TransactionClient;
    /** Fee-payer configuration for the eventual broadcast. Sponsored transactions are simulated after completion. */
    feePayer?: Account | true | undefined;
    /** Parsed client-signed Tempo transaction. */
    transaction: ReturnType<(typeof Transaction)['deserialize']>;
}): Promise<void>;
/**
 * Submit a settle transaction on-chain.
 */
export declare function settleOnChain(client: Client, descriptor: ChannelDescriptor, cumulativeAmount: bigint, signature: Hex, escrow?: Address, options?: ChannelTransactionOptions): Promise<Hex>;
/**
 * Submit a top-up transaction on-chain.
 */
export declare function topUpOnChain(client: Client, descriptor: ChannelDescriptor, additionalDeposit: bigint, escrow?: Address, options?: ChannelTransactionOptions): Promise<Hex>;
/**
 * Submit a request-close transaction on-chain.
 */
export declare function requestCloseOnChain(client: Client, descriptor: ChannelDescriptor, escrow?: Address, options?: ChannelTransactionOptions): Promise<Hex>;
/**
 * Submit a withdraw transaction on-chain.
 */
export declare function withdrawOnChain(client: Client, descriptor: ChannelDescriptor, escrow?: Address, options?: ChannelTransactionOptions): Promise<Hex>;
/**
 * Submit a close transaction on-chain.
 */
export declare function closeOnChain(client: Client, descriptor: ChannelDescriptor, cumulativeAmount: bigint, captureAmount: bigint, signature: Hex, escrow?: Address, options?: ChannelTransactionOptions): Promise<Hex>;
/** Receipt event shape emitted by TIP20EscrowChannel precompile management calls. */
export type ChannelReceiptEvent = {
    args: {
        channelId: Hex;
        expiringNonceHash?: Hex | undefined;
        deposit?: bigint | undefined;
        newDeposit?: bigint | undefined;
        newSettled?: bigint | undefined;
        settledToPayee?: bigint | undefined;
        refundedToPayer?: bigint | undefined;
    };
};
/** Receipt-like input used when extracting channel events from transaction logs. */
export type ChannelEventReceipt = {
    logs: Parameters<typeof parseEventLogs>[0]['logs'];
};
/**
 * Asserts that a deserialized transaction has an existing sender signature.
 */
export declare function assertSenderSigned(transaction: ReturnType<(typeof Transaction)['deserialize']>): void;
/** Broadcast a raw serialized transaction. */
export declare function sendTransaction(client: TransactionClient, transaction: Hex): Promise<`0x${string}`>;
/** Wait for a receipt and reject reverted precompile transactions. */
export declare function waitForSuccessfulReceipt(client: TransactionClient, hash: Hex): Promise<import("viem").TransactionReceipt>;
/** Extract exactly one channel event for a channel ID from a receipt. */
export declare function getChannelEvent(receipt: ChannelEventReceipt, name: 'ChannelOpened' | 'TopUp' | 'Settled' | 'ChannelClosed', channelId: Hex): ChannelReceiptEvent;
/** Inputs for broadcasting a client-signed precompile management transaction. */
export type SendCredentialTransactionParameters = {
    /** Challenge expiration propagated into fee-payer policy checks. */
    challengeExpires?: string | undefined;
    /** Chain ID used for fee-payer transaction signing. */
    chainId: number;
    /** viem client used to submit the transaction. */
    client: TransactionClient;
    /** Fee tokens allowed by the server for sponsored transactions. */
    allowedFeeTokens?: readonly Address[] | undefined;
    /** Human-readable transaction details used by fee-payer policy hooks. */
    details: Record<string, string>;
    /** Fee-payer account, or `true` when the client transport delegates co-signing to a hosted relay. */
    feePayer?: Account | true | undefined;
    /** Optional fee-payer policy enforced before co-signing. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Management transaction kind, used for validation errors. */
    label: 'open' | 'topUp';
    /** Client-signed serialized transaction. */
    serializedTransaction: Hex;
    /** Deserialized transaction corresponding to `serializedTransaction`. */
    transaction: ReturnType<(typeof Transaction)['deserialize']>;
};
/** Broadcasts a client-signed management transaction, adding a fee-payer co-signature when requested. */
export declare function sendCredentialTransaction(parameters: SendCredentialTransactionParameters): Promise<import("viem").TransactionReceipt>;
/** Result returned after a TIP-1034 open transaction is broadcast and verified. */
export type BroadcastOpenTransactionResult = {
    /** Broadcast transaction hash. */
    txHash: Hex;
    /** Descriptor recovered from the verified open transaction. */
    descriptor: ChannelDescriptor;
    /** Latest on-chain channel state after open. */
    state: ChannelState;
    /** Expiring nonce hash emitted by the open receipt. */
    expiringNonceHash: Hex;
    /** Deposit amount encoded in the open calldata. */
    openDeposit: bigint;
};
/** Inputs for broadcasting and verifying a client-signed TIP-1034 open transaction. */
export type BroadcastOpenTransactionParameters = {
    /** Fee tokens allowed when the server completes a sponsored transaction. Defaults to the channel currency. */
    allowedFeeTokens?: readonly Address[] | undefined;
    /** Hook invoked after calldata validation but before broadcasting. */
    beforeBroadcast?: ((result: Omit<BroadcastOpenTransactionResult, 'txHash' | 'state'>) => Promise<void> | void) | undefined;
    /** Challenge expiration propagated into fee-payer policy checks. */
    challengeExpires?: string | undefined;
    /** Chain ID used for channel ID and voucher domain separation. */
    chainId: number;
    /** viem client used for transaction submission and readback. */
    client: TransactionClient;
    /** TIP20EscrowChannel precompile address. */
    escrowContract: Address;
    /** Authorized voucher signer expected in the open calldata. */
    expectedAuthorizedSigner: Address;
    /** Channel ID expected from descriptor, escrow, and chain ID. */
    expectedChannelId: Hex;
    /** Payment token expected in the open calldata. */
    expectedCurrency: Address;
    /** Transaction-bound nonce hash expected in the descriptor. */
    expectedExpiringNonceHash: Hex;
    /** Payee-side operator expected in the open calldata. */
    expectedOperator: Address;
    /** Payment recipient expected in the open calldata. */
    expectedPayee: Address;
    /** Payer expected to have signed the open transaction. */
    expectedPayer: Address;
    /** Fee-payer account, or `true` when the client transport delegates co-signing to a hosted relay. */
    feePayer?: Account | true | undefined;
    /** Optional fee-payer policy enforced before co-signing. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Client-signed serialized open transaction. */
    serializedTransaction: Hex;
};
/** Inputs for validating a client-signed TIP-1034 open transaction without broadcasting it. */
export type ValidateOpenCredentialTransactionParameters = Omit<BroadcastOpenTransactionParameters, 'beforeBroadcast' | 'client'>;
/** Validated fields recovered from a client-signed TIP-1034 open transaction. */
export type ValidatedOpenCredentialTransaction = Omit<BroadcastOpenTransactionResult, 'state' | 'txHash'> & {
    /** Parsed client-signed transaction, reused by simulation and broadcast. */
    transaction: ReturnType<(typeof Transaction)['deserialize']>;
};
/** Validates the immutable fields of a client-signed TIP-1034 open transaction. */
export declare function validateOpenCredentialTransaction(parameters: ValidateOpenCredentialTransactionParameters): ValidatedOpenCredentialTransaction;
/** Broadcast and validate a client-signed TIP-1034 open transaction. */
export declare function broadcastOpenTransaction(parameters: BroadcastOpenTransactionParameters): Promise<BroadcastOpenTransactionResult>;
/** Result returned after a TIP-1034 top-up transaction is broadcast and verified. */
export type BroadcastTopUpTransactionResult = {
    /** Broadcast transaction hash. */
    txHash: Hex;
    /** New on-chain deposit emitted by the top-up receipt. */
    newDeposit: bigint;
    /** Latest on-chain channel state after top-up. */
    state: ChannelState;
};
/** Inputs for broadcasting and verifying a client-signed TIP-1034 top-up transaction. */
export type BroadcastTopUpTransactionParameters = {
    /** Additional deposit amount expected in the top-up calldata. */
    additionalDeposit: bigint;
    /** Fee tokens allowed when the server completes a sponsored transaction. Defaults to the channel currency. */
    allowedFeeTokens?: readonly Address[] | undefined;
    /** Challenge expiration propagated into fee-payer policy checks. */
    challengeExpires?: string | undefined;
    /** Chain ID used for fee-payer transaction signing. */
    chainId: number;
    /** viem client used for transaction submission and readback. */
    client: TransactionClient;
    /** Descriptor expected in the top-up calldata. */
    descriptor: ChannelDescriptor;
    /** TIP20EscrowChannel precompile address. */
    escrowContract: Address;
    /** Channel ID expected in the top-up receipt. */
    expectedChannelId: Hex;
    /** Payment token expected for sponsored transaction fee token checks. */
    expectedCurrency: Address;
    /** Fee-payer account, or `true` when the client transport delegates co-signing to a hosted relay. */
    feePayer?: Account | true | undefined;
    /** Optional fee-payer policy enforced before co-signing. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Client-signed serialized top-up transaction. */
    serializedTransaction: Hex;
};
/** Inputs for validating a client-signed TIP-1034 top-up transaction without broadcasting it. */
export type ValidateTopUpCredentialTransactionParameters = Omit<BroadcastTopUpTransactionParameters, 'client'>;
/** Validated fields recovered from a client-signed TIP-1034 top-up transaction. */
export type ValidatedTopUpCredentialTransaction = {
    /** Parsed client-signed transaction, reused by simulation and broadcast. */
    transaction: ReturnType<(typeof Transaction)['deserialize']>;
};
/** Validates the immutable fields of a client-signed TIP-1034 top-up transaction. */
export declare function validateTopUpCredentialTransaction(parameters: ValidateTopUpCredentialTransactionParameters): ValidatedTopUpCredentialTransaction;
/** Broadcast and validate a client-signed TIP-1034 top-up transaction. */
export declare function broadcastTopUpTransaction(parameters: BroadcastTopUpTransactionParameters): Promise<BroadcastTopUpTransactionResult>;
export {};
//# sourceMappingURL=Chain.d.ts.map