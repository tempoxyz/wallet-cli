import { InvalidConfigurationError, LimitExceededError } from './errors.js';
import { immutableSnapshot } from './immutable.js';
import { assertRequirement, resolvePolicy } from './policy.js';
import { neverAborted } from './time.js';
import { assertOperationId, assertPayer, canonicalIdentifier } from './validate.js';
/** Plans issued by this module; only these may be funded. */
const plans = new WeakSet();
/** Resolves metadata, selects one funder, and validates policy without moving funds. */
export async function planPayment(initial, options = {}) {
    return planSnapshot(immutableSnapshot(initial), resolvePolicy(options), funderSnapshots(options.funders));
}
/** Plans an already-snapshotted requirement with validated configuration. */
async function planSnapshot(selected, policy, funders) {
    // The client's own funding runs whichever funder matches, so no funder can enforce a ceiling on it.
    if (policy.maxFundingSpend && selected.unboundedFunding === true)
        throw new LimitExceededError("maxFundingSpend cannot bound the payment client's own funding");
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
        (selected.unboundedFunding === true) !== (resolved.unboundedFunding === true) ||
        !sameOptional(selected.currency, resolved.currency, (left, right) => left.toUpperCase() === right.toUpperCase()) ||
        !sameOptional(selected.decimals, resolved.decimals, (left, right) => left === right);
    if (changed)
        throw new InvalidConfigurationError('Funder resolution changed the selected payment');
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
        throw new InvalidConfigurationError('Payment plans must come from planPayment');
    const operationId = context.operationId ?? crypto.randomUUID();
    assertOperationId(operationId);
    if (context.payer !== undefined)
        assertPayer(context.payer);
    return fund(paymentPlan, {
        operationId,
        signal: context.signal ?? neverAborted,
        // Stryker disable next-line ConditionalExpression: fund drops an explicit undefined payer exactly like an omitted one
        ...(context.payer === undefined ? {} : { payer: context.payer }),
    });
}
async function fund({ funder, requirement, policy }, { operationId, signal, payer }) {
    signal.throwIfAborted();
    if (!funder)
        return undefined;
    if (policy.maxFundingSpend && !funder.enforcesFundingSpend)
        throw new InvalidConfigurationError('Funder does not enforce maxFundingSpend');
    const prepared = await funder.prepare(requirement, Object.freeze({ operationId, policy, signal, ...(payer === undefined ? {} : { payer }) }));
    signal.throwIfAborted();
    return prepared;
}
/** Builds the shared fail-closed policy and funding pipeline. */
export function createBeforePayment(options) {
    const policy = resolvePolicy(options);
    const funders = funderSnapshots(options.funders);
    // Captured once, like policy and funders: mutating the options later changes nothing.
    const { onFundingComplete, onPaymentFailed, onPaymentReady, onPaymentRequired } = options;
    // Observers run beside the payment, never in front of it, and cannot alter its control flow.
    const notify = (observer, event) => {
        // Stryker disable next-line ConditionalExpression: then(undefined) passes the event through unobserved; the guard only skips allocating promises
        if (observer)
            void Promise.resolve(Object.freeze(event))
                .then(observer)
                .catch(() => undefined);
    };
    return async (initial, context) => {
        const { operationId, signal } = context;
        let requirement = immutableSnapshot(initial);
        notify(onPaymentRequired, { operationId, requirement });
        try {
            signal.throwIfAborted();
            const paymentPlan = await planSnapshot(requirement, policy, funders);
            requirement = paymentPlan.requirement;
            const prepared = await fund(paymentPlan, context);
            if (prepared?.funding && paymentPlan.funder)
                notify(onFundingComplete, {
                    operationId,
                    funder: paymentPlan.funder.name,
                    requirement,
                    receipt: immutableSnapshot(prepared.funding),
                });
            notify(onPaymentReady, { operationId, requirement });
            signal.throwIfAborted();
            return prepared;
        }
        catch (cause) {
            const error = cause instanceof Error ? cause : new Error('Payment preparation failed');
            notify(onPaymentFailed, { operationId, requirement, error });
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
