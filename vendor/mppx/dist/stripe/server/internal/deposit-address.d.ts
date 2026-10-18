import type { StripeClient } from '../../internal/types.js';
import { type ConnectConfig } from './request.js';
export type DepositAddressResolver = (client: StripeClient, network: string, options?: {
    connect?: ConnectConfig;
}) => Promise<string>;
/**
 * Finds an existing deposit address or creates a new one for the given network.
 * Cached per client+network+stripeAccount for the process lifetime.
 */
export declare function findOrCreateDepositAddress(client: StripeClient, network: string, options?: {
    connect?: ConnectConfig;
}): Promise<string>;
//# sourceMappingURL=deposit-address.d.ts.map