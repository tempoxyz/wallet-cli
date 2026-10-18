import { type Address } from 'viem';
import { type Token } from 'viem/tokens';
import type { EvmAccount } from './interfaces/cross-chain.js';
/** Returns Base USDC metadata without enabling any route or provider. */
export declare function baseUsdcToken(): Token;
/** Creates the canonical Tempo OUSD side of a relay operation. */
export declare function tempoOusd(account: Address): EvmAccount;
/** Creates the canonical Base USDC side of a relay operation. */
export declare function baseUsdc(account: Address): EvmAccount;
//# sourceMappingURL=presets.d.ts.map