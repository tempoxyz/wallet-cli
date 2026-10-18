import type { Address, Hex } from 'viem';
import * as Channel from '../precompile/Channel.js';
import type { Uint96 } from '../precompile/Protocol.js';
/** Optional expected values used to validate a TIP-1034 `open` calldata payload. */
export type ParseOpenCallExpected = {
    authorizedSigner?: Address | undefined;
    deposit?: Uint96 | undefined;
    operator?: Address | undefined;
    payee?: Address | undefined;
    token?: Address | undefined;
};
/** Input for parsing and validating TIP-1034 `open` calldata. */
export type ParseOpenCallParameters = {
    data: Hex;
    expected?: ParseOpenCallExpected | undefined;
};
/** Decoded and uint96-validated TIP-1034 `open` calldata fields. */
export type ParsedOpenCall = {
    authorizedSigner: Address;
    deposit: Uint96;
    operator: Address;
    payee: Address;
    salt: Hex;
    token: Address;
};
/** Validates that calldata contains exactly one TIP-1034 approve-less `open` call. */
export declare function parseOpenCall(parameters: ParseOpenCallParameters): ParsedOpenCall;
/** Optional expected values used to validate a TIP-1034 `topUp` calldata payload. */
export type ParseTopUpCallExpected = {
    additionalDeposit?: Uint96 | undefined;
    descriptor?: Channel.ChannelDescriptor | undefined;
};
/** Input for parsing and validating TIP-1034 `topUp` calldata. */
export type ParseTopUpCallParameters = {
    data: Hex;
    expected?: ParseTopUpCallExpected | undefined;
};
/** Decoded and uint96-validated TIP-1034 `topUp` calldata fields. */
export type ParsedTopUpCall = {
    additionalDeposit: Uint96;
    descriptor: Channel.ChannelDescriptor;
};
/** Validates that calldata contains exactly one TIP-1034 descriptor-based `topUp` call. */
export declare function parseTopUpCall(parameters: ParseTopUpCallParameters): ParsedTopUpCall;
/** Input for deriving a TIP-1034 channel descriptor from an accepted open transaction. */
export type DescriptorFromOpenParameters = {
    chainId: number;
    channelId?: Hex | undefined;
    escrow?: Address | undefined;
    expiringNonceHash: Hex;
    open: ParsedOpenCall;
    payer: Address;
};
/** Builds and validates a descriptor from an accepted open call and event expiring nonce hash. */
export declare function descriptorFromOpen(parameters: DescriptorFromOpenParameters): Channel.ChannelDescriptor;
//# sourceMappingURL=ChannelOps.d.ts.map