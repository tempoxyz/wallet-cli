import * as z from '../../zod.js';
/** Stripe PaymentIntent options accepted only by server-side method input. */
export const Schema = z.object({
    customer: z.optional(z.string().check(z.minLength(1))),
    hooks: z.optional(z.object({
        inputs: z.object({
            tax: z.object({ calculation: z.string().check(z.minLength(1)) }),
        }),
    })),
    metadata: z.optional(z.record(z.string(), z.string())),
    receipt_email: z.optional(z.string().check(z.minLength(1))),
});
const ResolveOptionsSchema = z.custom((value) => typeof value === 'function');
/** PaymentIntent options accepted only by server-side method input. */
export const InputSchema = z.union([Schema, ResolveOptionsSchema]);
/** Resolves and validates request-scoped PaymentIntent options. */
export async function resolve(input, context) {
    const options = typeof input === 'function' ? await input(context) : input;
    return z.optional(Schema).parse(options);
}
//# sourceMappingURL=payment-intent.js.map