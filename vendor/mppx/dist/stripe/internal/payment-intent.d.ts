import type * as Challenge from '../../Challenge.js';
import type * as Credential from '../../Credential.js';
import type { MaybePromise } from '../../internal/types.js';
import type * as Method from '../../Method.js';
import * as z from '../../zod.js';
/** Stripe PaymentIntent options accepted only by server-side method input. */
export declare const Schema: z.ZodMiniObject<{
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
}, z.core.$strip>;
export type Options = z.infer<typeof Schema>;
/** Context provided when resolving request-scoped PaymentIntent options. */
export type ResolveOptionsContext = {
    challenge: Challenge.Challenge;
    credential: Credential.Credential;
    envelope?: Method.VerifiedChallengeEnvelope | undefined;
    request: Record<string, unknown>;
};
/** Lazily resolves request-scoped PaymentIntent options before the terminal payment operation. */
export type ResolveOptions = (context: ResolveOptionsContext) => MaybePromise<Options | undefined>;
export type OptionsInput = Options | ResolveOptions;
/** PaymentIntent options accepted only by server-side method input. */
export declare const InputSchema: z.ZodMiniUnion<readonly [z.ZodMiniObject<{
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
}, z.core.$strip>, z.ZodMiniCustom<ResolveOptions, ResolveOptions>]>;
/** Resolves and validates request-scoped PaymentIntent options. */
export declare function resolve(input: OptionsInput | undefined, context: ResolveOptionsContext): Promise<Options | undefined>;
//# sourceMappingURL=payment-intent.d.ts.map