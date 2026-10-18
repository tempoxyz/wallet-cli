import type * as RemoteFeePayer from '../../../tempo/internal/remote-fee-payer.js';
import type { StripeClient } from '../../internal/types.js';
/**
 * Creates an instance of a Stripe feepayer using an authenticated Stripe client.
 *
 * This compatibility path uses the Stripe client so that requests to the feepayer
 * retain their authentication, timeouts, telemetry, and request events.
 */
export declare function create(client: StripeClient): RemoteFeePayer.Config;
//# sourceMappingURL=hosted-fee-payer.d.ts.map