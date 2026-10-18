import { PaymentPolicyError } from './errors.js';
import { immutableSnapshot } from './immutable.js';
import { assetKey, isRecord, isTokenDecimals } from './validate.js';
const defaults = {
    sameCurrencyOnly: true,
    maxSlippageBps: 100,
    deadlineSeconds: 30,
};
/** Longest funding deadline; also keeps every derived timer far below the setTimeout limit. */
const maxDeadlineSeconds = 86_400;
/** Bounds human-readable policy input before decimal expansion. */
const maxDecimalAmountLength = 1_024;
/** Resolves defaults and validates a policy once at construction time. */
export function resolvePolicy(policy = {}) {
    const resolved = immutableSnapshot({ ...defaults, ...policy });
    if (!Number.isInteger(resolved.maxSlippageBps) ||
        resolved.maxSlippageBps < 0 ||
        resolved.maxSlippageBps > 10_000)
        throw configuration('maxSlippageBps must be an integer from 0 to 10000');
    if (!Number.isInteger(resolved.deadlineSeconds) ||
        resolved.deadlineSeconds <= 0 ||
        resolved.deadlineSeconds > maxDeadlineSeconds)
        throw configuration(`deadlineSeconds must be an integer from 1 to ${maxDeadlineSeconds}`);
    if (typeof resolved.sameCurrencyOnly !== 'boolean')
        throw configuration('sameCurrencyOnly must be a boolean');
    const { maxPayment } = resolved;
    if (maxPayment !== undefined)
        if (isAssetLimits(maxPayment))
            assertAssetLimits(maxPayment, 'maxPayment');
        else
            assertMoney(maxPayment);
    if (resolved.maxFundingSpend)
        assertAssetLimits(resolved.maxFundingSpend, 'maxFundingSpend');
    return resolved;
}
/**
 * Rejects a selected payment before funds or credentials are touched. A currency `maxPayment`
 * uses `currency` and `decimals` only when `trustedMetadata`, meaning a matching funder's
 * `resolve` returned them: a server that understates decimals must not shrink the payment.
 */
export function assertRequirement(requirement, policy, trustedMetadata) {
    if (requirement.amount < 0n)
        throw invalidPayment('Payment amount cannot be negative');
    if (requirement.decimals !== undefined && !isTokenDecimals(requirement.decimals))
        throw invalidPayment('Payment decimals must be an integer from 0 to 255');
    const { maxPayment } = policy;
    if (maxPayment === undefined)
        return;
    if (isAssetLimits(maxPayment)) {
        const key = assetKey(requirement);
        const limit = maxPayment.find((limit) => assetKey(limit) === key);
        if (!limit)
            throw limitExceeded('Payment asset has no maxPayment limit');
        if (requirement.amount > limit.amount)
            throw limitExceeded('Payment exceeds maxPayment');
        return;
    }
    if (!trustedMetadata)
        throw invalidPayment('A currency maxPayment requires metadata from a matching funder');
    if (requirement.currency?.toUpperCase() !== maxPayment.currency.toUpperCase())
        throw invalidPayment('Payment currency cannot be compared with maxPayment');
    if (requirement.decimals === undefined)
        throw invalidPayment('Payment decimals are required to enforce maxPayment');
    if (requirement.amount > parseUnits(maxPayment.amount, requirement.decimals))
        throw limitExceeded('Payment exceeds maxPayment');
}
/**
 * Parses a non-negative base-10 decimal without floating-point arithmetic. Precision beyond
 * `decimals` cannot be represented in the payment asset and is rejected.
 */
export function parseUnits(value, decimals) {
    const match = decimalPattern.exec(value);
    const fraction = match[2] ?? '';
    if (fraction.length > decimals)
        throw invalidPayment('maxPayment has more decimal places than the payment asset');
    return BigInt(`${match[1]}${fraction.padEnd(decimals, '0')}`);
}
/** Maximum input for a quoted amount under a slippage bound, rounded up. */
export function addSlippage(amount, basisPoints) {
    return (amount * BigInt(10_000 + basisPoints) + 9999n) / 10000n;
}
const decimalPattern = /^(\d+)(?:\.(\d+))?$/;
function isAssetLimits(limit) {
    return Array.isArray(limit);
}
function assertMoney(money) {
    const { amount, currency } = (money ?? {});
    if (typeof currency !== 'string' || !currency.trim())
        throw configuration('maxPayment currency must be a non-empty string');
    if (typeof amount !== 'string' ||
        amount.length > maxDecimalAmountLength ||
        !decimalPattern.test(amount))
        throw configuration('maxPayment amount must be a non-negative decimal string');
}
function assertAssetLimits(limits, name) {
    const keys = new Set();
    for (const limit of limits) {
        if (!isRecord(limit) ||
            typeof limit.network !== 'string' ||
            !limit.network.trim() ||
            typeof limit.asset !== 'string' ||
            !limit.asset.trim() ||
            typeof limit.amount !== 'bigint' ||
            limit.amount < 0n)
            throw configuration(`Invalid ${name} limit`);
        const key = assetKey(limit);
        if (keys.has(key))
            throw configuration(`Duplicate ${name} limit`);
        keys.add(key);
    }
}
function configuration(message) {
    return new PaymentPolicyError(message, { code: 'INVALID_CONFIGURATION' });
}
function invalidPayment(message) {
    return new PaymentPolicyError(message, { code: 'INVALID_PAYMENT' });
}
function limitExceeded(message) {
    return new PaymentPolicyError(message, { code: 'LIMIT_EXCEEDED' });
}
//# sourceMappingURL=policy.js.map