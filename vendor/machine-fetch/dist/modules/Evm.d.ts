/**
 * EVM types shared by funders and routes, and helpers that build limits and accounts from Viem
 * tokens.
 * @module
 */
import type { Address } from 'viem';
import type { Token as ViemToken } from 'viem/tokens';
import type { EvmTokenAccount } from '../interfaces/cross-chain.js';
import type { AssetAmount } from '../interfaces/policy.js';
import type * as Errors from './Errors.js';
export type { EvmTokenAccount as TokenAccount } from '../interfaces/cross-chain.js';
export type { EvmClient as Client, EvmToken as Token } from '../interfaces/evm.js';
/**
 * A per-asset limit for `maxPayment` or `maxFundingSpend`, from a Viem token, a chain, and a
 * decimal amount in the token's units.
 *
 * @example
 * ```ts
 * import { base } from 'viem/chains'
 * import { usdc } from 'viem/tokens'
 *
 * Evm.amount({ token: usdc, chainId: base.id, amount: '0.10' })
 * // { network: 'eip155:8453', asset: '0x8335…2913', amount: 100000n }
 * ```
 */
export declare const amount: (parameters: amount.Parameters) => AssetAmount;
export declare namespace amount {
    /** Parameters for {@link amount}. */
    type Parameters = Readonly<{
        /** Viem token, such as `usdc` from `viem/tokens`. */
        token: ViemToken;
        /** Chain the token is paid on; the token must have an address there. */
        chainId: number;
        /** Decimal amount in the token's units, such as `'0.10'`. Atomic bigints are rejected. */
        amount: string;
    }>;
    /** Errors {@link amount} can throw. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/**
 * The account that holds a Viem token on one chain for `owner`, as `CrossChainFunder.create` takes
 * for `from` and `to`.
 *
 * @example
 * ```ts
 * Evm.tokenAccount({ token: usdc, chainId: base.id, owner: account.address })
 * ```
 */
export declare const tokenAccount: (parameters: tokenAccount.Parameters) => EvmTokenAccount;
export declare namespace tokenAccount {
    /** Parameters for {@link tokenAccount}. */
    type Parameters = Readonly<{
        /** Viem token with a reference currency, such as `usdc` from `viem/tokens`. */
        token: ViemToken;
        /** Chain the account holds the token on. */
        chainId: number;
        /** Address that holds the token and signs or receives funding. */
        owner: Address;
    }>;
    /** Errors {@link tokenAccount} can throw. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
