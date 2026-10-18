import { charge as charge_ } from './Charge.js';
/**
 * Creates a Stripe `charge` client method.
 *
 * @example
 * ```ts
 * import { Mppx, stripe } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [
 *     stripe({
 *       createToken: async (params) => {
 *         const res = await fetch('/api/create-spt', {
 *           method: 'POST',
 *           headers: { 'Content-Type': 'application/json' },
 *           body: JSON.stringify(params),
 *         })
 *         const { spt } = await res.json()
 *         return spt
 *       },
 *       paymentMethod: 'pm_card_visa',
 *     }),
 *   ],
 * })
 * ```
 */
export function stripe(parameters) {
    return [charge_(parameters)];
}
(function (stripe) {
    /** Creates a Stripe `charge` client method for SPT-based payments. */
    stripe.charge = charge_;
})(stripe || (stripe = {}));
//# sourceMappingURL=Methods.js.map