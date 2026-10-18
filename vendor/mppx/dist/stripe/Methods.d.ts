import * as z from '../zod.js';
import * as PaymentIntent from './internal/payment-intent.js';
/**
 * Stripe charge intent for one-time payments via Shared Payment Tokens (SPTs).
 *
 * @see https://github.com/tempoxyz/payment-auth-spec/blob/main/specs/methods/stripe/draft-stripe-charge-00.md
 */
export declare const charge: {
    readonly name: "stripe";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: z.ZodMiniObject<{
                externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
                spt: z.ZodMiniString<string>;
            }, z.core.$strip>;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            metadata: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniString<string>>>;
            networkId: z.ZodMiniString<string>;
            paymentIntentOptions: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniObject<{
                customer: z.ZodMiniOptional<z.ZodMiniString<string>>;
                hooks: z.ZodMiniOptional<z.ZodMiniObject<{
                    inputs: z.ZodMiniObject<{
                        tax: z.ZodMiniObject<{
                            calculation: z.ZodMiniString<string>;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                metadata: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniString<string>>>;
                receipt_email: z.ZodMiniOptional<z.ZodMiniString<string>>;
            }, z.core.$strip>, z.ZodMiniCustom<PaymentIntent.ResolveOptions, PaymentIntent.ResolveOptions>]>>;
            paymentMethodTypes: z.ZodMiniArray<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            currency: string;
            description?: string | undefined;
            externalId?: string | undefined;
            recipient?: string | undefined;
            amount: string;
            methodDetails: {
                networkId: string;
                paymentMethodTypes: string[];
                metadata?: Record<string, string> | undefined;
            };
        }, {
            amount: string;
            currency: string;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            metadata?: Record<string, string> | undefined;
            networkId: string;
            paymentIntentOptions?: PaymentIntent.ResolveOptions | {
                customer?: string | undefined;
                hooks?: {
                    inputs: {
                        tax: {
                            calculation: string;
                        };
                    };
                } | undefined;
                metadata?: Record<string, string> | undefined;
                receipt_email?: string | undefined;
            } | undefined;
            paymentMethodTypes: string[];
            recipient?: string | undefined;
        }>>;
    };
};
//# sourceMappingURL=Methods.d.ts.map