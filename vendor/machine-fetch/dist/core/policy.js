import { InvalidConfigurationError, InvalidPaymentError, LimitExceededError } from './errors.js';
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
/**
 * Rejects the nested `policy` option that flat policy fields replaced. Untyped callers, and options
 * built outside an object literal, would otherwise lose every limit without an error.
 */
export function assertFlatPolicy(options) {
    if (Object.hasOwn(options, 'policy'))
        throw new InvalidConfigurationError('The policy option was removed; pass maxPayment and the other policy fields directly');
}
/**
 * Resolves defaults and validates the policy fields of flat options once at construction time.
 * Only policy fields are read, so options may carry funders, observers, or adapter settings.
 */
export function resolvePolicy(options = {}) {
    assertFlatPolicy(options);
    // Not a spread over defaults: an explicit `undefined` keeps the default, while `null` from an
    // untyped caller still fails validation below.
    const pick = (key) => options[key] === undefined ? defaults[key] : options[key];
    const { maxPayment, maxFundingSpend } = options;
    const resolved = immutableSnapshot({
        ...(maxPayment === undefined ? {} : { maxPayment }),
        ...(maxFundingSpend === undefined ? {} : { maxFundingSpend }),
        sameCurrencyOnly: pick('sameCurrencyOnly'),
        maxSlippageBps: pick('maxSlippageBps'),
        deadlineSeconds: pick('deadlineSeconds'),
    });
    if (!Number.isInteger(resolved.maxSlippageBps) ||
        resolved.maxSlippageBps < 0 ||
        resolved.maxSlippageBps > 10_000)
        throw new InvalidConfigurationError('maxSlippageBps must be an integer from 0 to 10000');
    if (!Number.isInteger(resolved.deadlineSeconds) ||
        resolved.deadlineSeconds <= 0 ||
        resolved.deadlineSeconds > maxDeadlineSeconds)
        throw new InvalidConfigurationError(`deadlineSeconds must be an integer from 1 to ${maxDeadlineSeconds}`);
    if (typeof resolved.sameCurrencyOnly !== 'boolean')
        throw new InvalidConfigurationError('sameCurrencyOnly must be a boolean');
    if (resolved.maxPayment !== undefined)
        if (isAssetLimits(resolved.maxPayment))
            assertAssetLimits(resolved.maxPayment, 'maxPayment');
        else
            assertMoney(resolved.maxPayment);
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
        throw new InvalidPaymentError('Payment amount cannot be negative');
    if (requirement.decimals !== undefined && !isTokenDecimals(requirement.decimals))
        throw new InvalidPaymentError('Payment decimals must be an integer from 0 to 255');
    const { maxPayment } = policy;
    if (maxPayment === undefined)
        return;
    if (isAssetLimits(maxPayment)) {
        const key = assetKey(requirement);
        const limit = maxPayment.find((limit) => assetKey(limit) === key);
        if (!limit)
            throw new LimitExceededError('Payment asset has no maxPayment limit');
        if (requirement.amount > limit.amount)
            throw new LimitExceededError('Payment exceeds maxPayment');
        return;
    }
    if (!trustedMetadata)
        throw new InvalidPaymentError('A currency maxPayment requires metadata from a matching funder');
    if (requirement.currency?.toUpperCase() !== maxPayment.currency.toUpperCase())
        throw new InvalidPaymentError('Payment currency cannot be compared with maxPayment');
    if (requirement.decimals === undefined)
        throw new InvalidPaymentError('Payment decimals are required to enforce maxPayment');
    if (requirement.amount > parseUnits(maxPayment.amount, requirement.decimals))
        throw new LimitExceededError('Payment exceeds maxPayment');
}
/**
 * Parses a non-negative base-10 decimal without floating-point arithmetic. Precision beyond
 * `decimals` cannot be represented in the payment asset and is rejected.
 */
export function parseUnits(value, decimals) {
    const match = decimalPattern.exec(value);
    const fraction = match[2] ?? '';
    if (fraction.length > decimals)
        throw new InvalidPaymentError('maxPayment has more decimal places than the payment asset');
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
        throw new InvalidConfigurationError('maxPayment currency must be a non-empty string');
    if (typeof amount !== 'string' ||
        amount.length > maxDecimalAmountLength ||
        !decimalPattern.test(amount))
        throw new InvalidConfigurationError('maxPayment amount must be a non-negative decimal string');
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
            throw new InvalidConfigurationError(`Invalid ${name} limit`);
        const key = assetKey(limit);
        if (keys.has(key))
            throw new InvalidConfigurationError(`Duplicate ${name} limit`);
        keys.add(key);
    }
}
