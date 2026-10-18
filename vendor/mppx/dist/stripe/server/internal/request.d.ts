import type { StripeClient } from '../../internal/types.js';
export type ConnectConfig = {
    stripeAccount: string;
    applicationFeeAmount?: number;
    onBehalfOf?: string;
    transferData?: {
        amount?: number;
        destination: string;
    };
    transferGroup?: string;
};
/** Creates a Stripe PaymentIntent using the SDK client. Handles Connect param mapping. */
export declare function createPaymentIntent(client: StripeClient, params: Record<string, unknown>, options?: {
    idempotencyKey?: string;
    connect?: ConnectConfig;
}): Promise<{
    id: string;
    status: string;
    replayed: boolean;
}>;
/** Makes a raw Stripe API request using the SDK client. */
export declare function stripeRequest(client: StripeClient, method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, options?: {
    connect?: ConnectConfig;
}): Promise<unknown>;
//# sourceMappingURL=request.d.ts.map