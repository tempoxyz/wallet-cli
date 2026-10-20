import { type Address } from 'viem';
import type { Token } from 'viem/tokens';
import type { EvmTokenAccount } from '../interfaces/cross-chain.js';
import type { AssetAmount } from '../interfaces/policy.js';
/** Implements `Evm.amount`. */
export declare function evmAmount(parameters: Readonly<{
    token: Token;
    chainId: number;
    amount: string;
}>): AssetAmount;
/** Implements `Evm.tokenAccount`. */
export declare function evmTokenAccount(parameters: Readonly<{
    token: Token;
    chainId: number;
    owner: Address;
}>): EvmTokenAccount;
