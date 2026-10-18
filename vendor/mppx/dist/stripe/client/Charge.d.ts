import type * as Challenge from '../../Challenge.js';
import * as Method from '../../Method.js';
import * as z from '../../zod.js';
import type { StripeJs } from '../internal/types.js';
import * as Methods from '../Methods.js';
/**
 * Creates a Stripe charge method intent for usage on the client.
 *
 * Accepts a `createToken` callback that handles SPT creation (requires
 * a secret key, so typically proxied through a server endpoint) and
 * returns a credential for retrying the request.
 *
 * The `paymentMethod` (e.g. from Stripe Elements) can be provided at
 * initialization or at credential-creation time via `context`.
 *
 * Optionally accepts a `client` (a Stripe.js instance from `@stripe/stripe-js`)
 * which is forwarded to the `createToken` callback for use with Elements.
 *
 * @example
 * ```ts
 * import { loadStripe } from '@stripe/stripe-js'
 * import { stripe } from 'mppx/client'
 *
 * const stripeJs = await loadStripe('pk_...')
 *
 * const charge = stripe.charge({
 *   client: stripeJs,
 *   createToken: async ({ amount, currency, expiresAt, metadata, networkId, paymentMethod }) => {
 *     const res = await fetch('/api/create-spt', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ paymentMethod, amount, currency, networkId, expiresAt, metadata }),
 *     })
 *     const { spt } = await res.json()
 *     return spt
 *   },
 * })
 * ```
 */
export declare function charge(parameters: charge.Parameters): Method.Client<{
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
            }, z.core.$strip>, z.ZodMiniCustom<import("../internal/payment-intent.js").ResolveOptions, import("../internal/payment-intent.js").ResolveOptions>]>>;
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
            paymentIntentOptions?: import("../internal/payment-intent.js").ResolveOptions | {
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
}, z.ZodMiniObject<{
    paymentMethod: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>>;
export declare namespace charge {
    type Parameters = {
        /** Stripe.js instance from `@stripe/stripe-js`. Forwarded to `createToken` for use with Elements. */
        client?: StripeJs | undefined;
        /** Called when a Stripe challenge is received. Create an SPT to retry. */
        createToken: (parameters: OnChallengeParameters) => Promise<string>;
        /** Optional fallback external reference ID. A request-bound externalId is echoed and takes precedence. */
        externalId?: string | undefined;
        /** Default payment method ID. Overridden by `context.paymentMethod`. */
        paymentMethod?: string | undefined;
    };
    type OnChallengeParameters = {
        /** Payment amount (in smallest currency unit). */
        amount: string;
        challenge: Challenge.Challenge<z.output<typeof Methods.charge.schema.request>, typeof Methods.charge.intent, typeof Methods.charge.name>;
        /** Stripe.js instance, if provided to `stripe.charge()`. */
        client?: StripeJs | undefined;
        /** Three-letter ISO currency code. */
        currency: string;
        /** SPT expiration as a Unix timestamp (seconds). */
        expiresAt: number;
        /** Optional metadata to associate with the SPT. */
        metadata?: Record<string, string> | undefined;
        /** Stripe Business Network profile ID. */
        networkId: string | undefined;
        /** Stripe payment method ID (e.g. from Stripe Elements). */
        paymentMethod?: string | undefined;
    };
}
//# sourceMappingURL=Charge.d.ts.map