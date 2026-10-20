/**
 * Payment requirements, the protocol client interface, and the two steps a paid request runs
 * before signing: {@link plan} and {@link fund}.
 * @module
 */
import { fundPayment, planPayment } from '../core/prepare.js';
/**
 * Resolves metadata, selects one funder, and validates policy without moving funds.
 *
 * @example
 * ```ts
 * const plan = await Payment.plan(requirement, { maxPayment, funders })
 * if (plan.funder) console.log(plan.funder.name)
 * ```
 */
export const plan = planPayment;
/**
 * Runs the plan's funder, if any. Only plans returned by {@link plan} are accepted, so a modified
 * copy cannot bypass the policy it was validated against.
 */
export const fund = fundPayment;
