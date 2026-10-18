import type * as Challenge from '../../Challenge.js';
import type * as Credential from '../../Credential.js';
import type { ConfiguredDefaults, LooseOmit, MaybePromise, OneOf } from '../../internal/types.js';
import * as Method from '../../Method.js';
import type * as Html from '../../server/internal/html/config.ts';
import type * as z from '../../zod.js';
import * as PaymentIntent from '../internal/payment-intent.js';
import type { StripeClient, CreatePaymentMethodFromElements, StripeElementsOptionsMode, StripePaymentElementOptions } from '../internal/types.js';
import * as Methods from '../Methods.js';
/**
 * Creates a Stripe charge method intent for usage on the server.
 *
 * Verifies payment by creating a Stripe PaymentIntent with the provided SPT.
 *
 * Accepts either a `client` (a pre-configured Stripe SDK instance) or a raw
 * `secretKey`. Using `client` is recommended—it lets you configure retries,
 * API version, and other options on the Stripe instance you control.
 *
 * @example
 * ```ts
 * import Stripe from 'stripe'
 * import { stripe } from 'mppx/server'
 *
 * const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!)
 * const charge = stripe.charge({ client: stripeClient, networkId: 'internal', paymentMethodTypes: ['card'] })
 * ```
 *
 * @example
 * ```ts
 * import { stripe } from 'mppx/server'
 *
 * const charge = stripe.charge({ secretKey: 'sk_...', networkId: 'internal', paymentMethodTypes: ['card'] })
 * ```
 */
export declare function charge<const parameters extends charge.Parameters>(parameters: parameters): Method.Server<{
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
}, charge.DeriveDefaults<parameters>, undefined, {}, undefined>;
export declare namespace charge {
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.charge>, 'recipient'>;
    type Parameters = {
        /** Render payment page when Accept header is text/html (e.g. in browsers) */
        html?: ({
            createTokenUrl: string;
            elements?: {
                options?: StripeElementsOptionsMode | undefined;
                paymentOptions?: StripePaymentElementOptions | undefined;
                createPaymentMethodOptions?: CreatePaymentMethodFromElements | undefined;
            } | undefined;
            publishableKey: string;
        } & Html.Config) | undefined;
        /** Optional metadata to include in SPT creation requests. */
        metadata?: Record<string, string> | undefined;
        /** Optional server-side Stripe Connect settlement policy. Not included in MPP challenges. */
        connect?: ConnectSettlement | ResolveConnectSettlement | undefined;
    } & Method.ComposableHooks<typeof Methods.charge> & Defaults & OneOf<{
        /** Pre-configured Stripe SDK instance. Any object matching the duck-typed `StripeClient` shape works. */
        client: StripeClient;
    } | {
        /** Stripe secret API key. */
        secretKey: string;
    }>;
    /**
     * Captures only configuration values that are known to exist at runtime.
     *
     * The returned handler requires any remaining request fields. In particular,
     * `decimals` remains required when it was not configured on `stripe.charge()`.
     */
    type DeriveDefaults<parameters extends Parameters> = ConfiguredDefaults<parameters, Defaults>;
    type ResolvePaymentIntentOptionsContext = PaymentIntent.ResolveOptionsContext;
    /**
     * Server-side Stripe Connect settlement parameters.
     *
     * @see https://docs.stripe.com/connect/destination-charges
     */
    type ConnectSettlement = {
        /** Connected account used as the Stripe account context for the request. */
        stripeAccount?: string | undefined;
        /** Platform application fee amount in the smallest currency unit. */
        applicationFeeAmount?: number | undefined;
        /** Connected account used as the business of record. */
        onBehalfOf?: string | undefined;
        /** Destination transfer created from the PaymentIntent. */
        transferData?: {
            amount?: number | undefined;
            destination: string;
        } | undefined;
        /** Reconciliation token linking related charges and transfers. */
        transferGroup?: string | undefined;
    };
    type ResolveConnectSettlement = (parameters: {
        challenge: Challenge.Challenge<z.output<typeof Methods.charge.schema.request>, 'charge', 'stripe'>;
        credential: Credential.Credential<z.output<typeof Methods.charge.schema.credential.payload>, Challenge.Challenge<z.output<typeof Methods.charge.schema.request>, 'charge', 'stripe'>>;
        envelope?: Method.VerifiedChallengeEnvelope<z.output<typeof Methods.charge.schema.request>, z.output<typeof Methods.charge.schema.credential.payload>, 'charge', 'stripe'> | undefined;
        request: z.output<typeof Methods.charge.schema.request>;
    }) => MaybePromise<ConnectSettlement | undefined>;
}
//# sourceMappingURL=Charge.d.ts.map