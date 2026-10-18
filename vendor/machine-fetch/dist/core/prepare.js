import { PaymentPolicyError } from './errors.js';
import { immutableSnapshot } from './immutable.js';
import { assertRequirement, resolvePolicy } from './policy.js';
import { neverAborted } from './time.js';
import { assertAttemptId, assertPayer, canonicalIdentifier } from './validate.js';
/** Plans issued by this module; only these may be funded. */
const plans = new WeakSet();
/** Resolves metadata, selects one funder, and validates policy without moving funds. */
export async function planPayment(initial, options = {}) {
    return planSnapshot(immutableSnapshot(initial), resolvePolicy(options.policy), funderSnapshots(options.funders));
}
/** Plans an already-snapshotted requirement with validated configuration. */
async function planSnapshot(selected, policy, funders) {
    for (const funder of funders) {
        const resolved = funder.resolve ? await funder.resolve(selected) : selected;
        if (!resolved)
            continue;
        if (resolved !== selected)
            assertSamePayment(selected, resolved);
        const requirement = resolved === selected ? selected : immutableSnapshot(resolved);
        assertRequirement(requirement, policy, funder.resolve !== undefined);
        return issue({ requirement, policy, funder });
    }
    assertRequirement(selected, policy, false);
    return issue({ requirement: selected, policy });
}
function issue(plan) {
    const frozen = Object.freeze(plan);
    plans.add(frozen);
    return frozen;
}
function assertSamePayment(selected, resolved) {
    const identifier = (value) => canonicalIdentifier(selected.network, value);
    const changed = selected.protocol !== resolved.protocol ||
        selected.method !== resolved.method ||
        selected.intent !== resolved.intent ||
        selected.network !== resolved.network ||
        identifier(selected.asset) !== identifier(resolved.asset) ||
        selected.amount !== resolved.amount ||
        identifier(selected.recipient) !== identifier(resolved.recipient) ||
        selected.resource !== resolved.resource ||
        !sameOptional(selected.currency, resolved.currency, (left, right) => left.toUpperCase() === right.toUpperCase()) ||
        !sameOptional(selected.decimals, resolved.decimals, (left, right) => left === right);
    if (changed)
        throw new PaymentPolicyError('Funder resolution changed the selected payment', {
            code: 'INVALID_CONFIGURATION',
        });
}
/** A value the payment did not specify may be filled in; a specified one must be preserved. */
function sameOptional(selected, resolved, same) {
    if (selected === undefined)
        return true;
    return resolved !== undefined && same(selected, resolved);
}
/**
 * Runs the plan's funder, if any. Only plans returned by {@link planPayment} are accepted, so a
 * modified copy cannot bypass the policy it was validated against.
 */
export async function fundPayment(paymentPlan, context = {}) {
    if (!plans.has(paymentPlan))
        throw new PaymentPolicyError('Payment plans must come from planPayment', {
            code: 'INVALID_CONFIGURATION',
        });
    const attemptId = context.attemptId ?? crypto.randomUUID();
    assertAttemptId(attemptId);
    if (context.payer !== undefined)
        assertPayer(context.payer);
    return fund(paymentPlan, {
        attemptId,
        signal: context.signal ?? neverAborted,
        // Stryker disable next-line ConditionalExpression: fund drops an explicit undefined payer exactly like an omitted one
        ...(context.payer === undefined ? {} : { payer: context.payer }),
    });
}
async function fund({ funder, requirement, policy }, { attemptId, signal, payer }) {
    signal.throwIfAborted();
    if (!funder)
        return undefined;
    if (policy.maxFundingSpend && !funder.enforcesFundingSpend)
        throw new PaymentPolicyError('Funder does not enforce maxFundingSpend', {
            code: 'INVALID_CONFIGURATION',
        });
    const prepared = await funder.prepare(requirement, Object.freeze({ attemptId, policy, signal, ...(payer === undefined ? {} : { payer }) }));
    signal.throwIfAborted();
    return prepared;
}
/** Builds the shared fail-closed policy and funding pipeline. */
export function createBeforePayment(options) {
    const policy = resolvePolicy(options.policy);
    const funders = funderSnapshots(options.funders);
    const onEvent = options.onEvent;
    // Observers run beside the payment, never in front of it, and cannot alter its control flow.
    const emit = (event) => {
        // Stryker disable next-line ConditionalExpression: then(undefined) passes the event through unobserved; the guard only skips allocating promises
        if (onEvent)
            void Promise.resolve(Object.freeze(event))
                .then(onEvent)
                .catch(() => undefined);
    };
    return async (initial, context) => {
        const { attemptId, signal } = context;
        let requirement = immutableSnapshot(initial);
        emit({ type: 'payment.challenge', attemptId, requirement });
        try {
            signal.throwIfAborted();
            const paymentPlan = await planSnapshot(requirement, policy, funders);
            requirement = paymentPlan.requirement;
            const prepared = await fund(paymentPlan, context);
            if (prepared?.funding && paymentPlan.funder)
                emit({
                    type: 'funding.complete',
                    attemptId,
                    funder: paymentPlan.funder.name,
                    requirement,
                    receipt: immutableSnapshot(prepared.funding),
                });
            emit({ type: 'payment.ready', attemptId, requirement });
            signal.throwIfAborted();
            return prepared;
        }
        catch (cause) {
            const error = cause instanceof Error ? cause : new Error('Payment preparation failed');
            emit({ type: 'payment.failed', attemptId, requirement, error });
            throw error;
        }
    };
}
function funderSnapshots(funders = []) {
    return Object.freeze(funders.map((funder) => {
        const resolve = funder.resolve?.bind(funder);
        return Object.freeze({
            name: funder.name,
            enforcesFundingSpend: funder.enforcesFundingSpend === true,
            ...(resolve ? { resolve } : {}),
            prepare: funder.prepare.bind(funder),
        });
    }));
}
//# sourceMappingURL=prepare.js.map