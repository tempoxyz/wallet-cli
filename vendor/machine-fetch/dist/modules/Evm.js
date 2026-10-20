import { evmAmount, evmTokenAccount } from '../funders/tokens.js';
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
export const amount = evmAmount;
/**
 * The account that holds a Viem token on one chain for `owner`, as `CrossChainFunder.create` takes
 * for `from` and `to`.
 *
 * @example
 * ```ts
 * Evm.tokenAccount({ token: usdc, chainId: base.id, owner: account.address })
 * ```
 */
export const tokenAccount = evmTokenAccount;
