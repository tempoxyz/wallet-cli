import type * as Challenge from '../../Challenge.js';
import { type Network } from '../utils.js';
import { type Plugin } from './plugin.js';
/**
 * Orders Tempo charge challenges by whether the configured wallet can satisfy them.
 *
 * Direct balances are preferred first. Unsupported or unpayable challenges keep
 * their original relative order.
 */
export declare function orderTempoChargeChallengesByBalance(challenges: readonly Challenge.Challenge[], ctx: {
    options: {
        account?: string | undefined;
        network?: Network | undefined;
        rpcUrl?: string | undefined;
    };
}): Promise<Challenge.Challenge[]>;
export declare function tempo(): Plugin;
interface TempoKeyEntry {
    wallet_type: string;
    wallet_address: string;
    chain_id: number;
}
export declare function readTempoKeystore(): TempoKeyEntry[];
export declare function resolveTempoAccount(accountName: string): TempoKeyEntry | undefined;
export {};
//# sourceMappingURL=tempo.d.ts.map