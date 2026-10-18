import type * as PaymentIntent from '../../internal/payment-intent.js';
import type { StripeClient } from '../../internal/types.js';
import type { stripe } from '../Methods.js';
import { type ConnectConfig } from './request.js';
/**
 * Records a crypto payment as a Stripe PaymentIntent using transaction_verification mode.
 * If Stripe rejects caller-provided optional fields, retries once without them.
 * Errors are logged but never thrown (the returned Promise always resolves).
 */
export declare function recordCryptoPayment(client: StripeClient, parameters: {
    network: stripe.Network;
    reference: string;
    amount: string;
    connect?: ConnectConfig;
    analyticsMetadata: Record<string, string>;
    paymentIntentOptions?: PaymentIntent.Options | undefined;
}): Promise<void>;
//# sourceMappingURL=record-payment.d.ts.map