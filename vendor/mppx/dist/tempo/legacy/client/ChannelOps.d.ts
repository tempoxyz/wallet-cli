/**
 * Shared client-side channel operations.
 *
 * Provides the low-level helpers that both `session()`
 * and `sessionManager()` (orchestrator) rely on: escrow resolution, channel
 * ID computation, on-chain open/voucher/close payload construction, channel
 * recovery from on-chain state, and credential serialization.
 */
import { Hex } from 'ox';
import { type Address, type Account as viem_Account, type Client as viem_Client } from 'viem';
import type { Challenge } from '../../../Challenge.js';
import type { LegacySessionCredentialPayload } from '../session/Types.js';
/** Cached channel metadata used by the legacy auto-driving session client. */
export type ChannelEntry = {
    /** Voucher authority the channel was opened with. */
    authorizedSigner: Address;
    /** Legacy contract-backed channel ID. */
    channelId: Hex.Hex;
    /** Salt used to derive the channel ID. */
    salt: Hex.Hex;
    /** Highest cumulative voucher amount locally authorized. */
    cumulativeAmount: bigint;
    /** Escrow contract backing this channel. */
    escrowContract: Address;
    /** Chain ID used for channel ID and voucher domain separation. */
    chainId: number;
    /** Whether the client considers the channel reusable. */
    opened: boolean;
};
/** Resolves the chain ID embedded in a legacy session challenge. */
export declare function resolveChainId(challenge: Challenge): number;
/** Resolves the server-advertised escrow against the client's trust policy. */
export declare function resolveEscrow(challenge: {
    request: {
        methodDetails?: unknown;
    };
}, chainId: number, escrowContractOverride?: Address, allowCustomEscrow?: boolean): Address;
/** Serializes a legacy session credential with a payer DID source. */
export declare function serializeCredential(challenge: Challenge, payload: LegacySessionCredentialPayload, chainId: number, account: viem_Account): string;
/** Creates a legacy cumulative voucher credential payload. */
export declare function createVoucherPayload(client: viem_Client, account: viem_Account, channelId: Hex.Hex, cumulativeAmount: bigint, escrowContract: Address, chainId: number, voucherSigner?: viem_Account | undefined): Promise<LegacySessionCredentialPayload>;
/** Creates a legacy cooperative close credential payload. */
export declare function createClosePayload(client: viem_Client, account: viem_Account, channelId: Hex.Hex, cumulativeAmount: bigint, escrowContract: Address, chainId: number, voucherSigner?: viem_Account | undefined): Promise<LegacySessionCredentialPayload>;
/** Creates a legacy open transaction credential payload and local channel entry. */
export declare function createOpenPayload(client: viem_Client, account: viem_Account, options: {
    voucherSigner?: viem_Account | undefined;
    escrowContract: Address;
    payee: Address;
    currency: Address;
    deposit: bigint;
    initialAmount: bigint;
    chainId: number;
    feePayer?: boolean | undefined;
}): Promise<{
    entry: ChannelEntry;
    payload: LegacySessionCredentialPayload;
}>;
/**
 * Attempt to recover an existing on-chain channel by reading its state.
 *
 * If the channel has a positive deposit and is not finalized, returns a
 * {@link ChannelEntry} with `cumulativeAmount` set to the on-chain settled
 * amount (the safe starting point for new vouchers).
 *
 * Returns `undefined` if the channel doesn't exist, has zero deposit,
 * or is already finalized.
 */
export declare function tryRecoverChannel(client: viem_Client, escrowContract: Address, channelId: Hex.Hex, chainId: number): Promise<ChannelEntry | undefined>;
//# sourceMappingURL=ChannelOps.d.ts.map