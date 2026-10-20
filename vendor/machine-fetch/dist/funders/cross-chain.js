import { failureCause, settleConcurrent } from '../core/concurrent.js';
import { FundingError, InvalidConfigurationError, NoRouteError } from '../core/errors.js';
import { immutableSnapshot } from '../core/immutable.js';
import { addSlippage, resolvePolicy } from '../core/policy.js';
import { acquiredReceipt, availableReceipt } from '../core/receipt.js';
import { neverAborted, nowSeconds, untilDeadline, withTimeout } from '../core/time.js';
import { assertQuoteOptions, assetKey, canonicalIdentifier, isEvmAddress, isPayer, isPositive, isRecord, isTokenDecimals, } from '../core/validate.js';
import { recoveryError, settleOperation } from './operation.js';
const defaultConcurrency = 4;
const defaultTimeoutMs = 10_000;
const defaultPollIntervalMs = 1_000;
/**
 * Creates a funder that obtains an exact payment shortfall through trusted cross-chain routes.
 * Payment funding uses the request's operation ID as its durable operation ID.
 */
export function crossChainFunder(options) {
    const settings = settingsOf(options);
    const { from, to } = settings;
    const fund = async (requirement, policy, operationId, outerSignal) => {
        outerSignal.throwIfAborted();
        if (!matchesDestination(requirement, to))
            throw new InvalidConfigurationError('Cross-chain destination does not match the selected payment');
        if (policy.sameCurrencyOnly && from.currency.toUpperCase() !== to.currency.toUpperCase())
            throw new NoRouteError('Cross-chain source and destination currencies do not match');
        assertOperationId(operationId);
        const requirementKey = requirementKeyOf(requirement);
        const deadline = nowSeconds() + policy.deadlineSeconds;
        // Once funding work starts, another worker sharing this ID may claim and submit it at any time,
        // so expiry and cancellation always require reconciliation.
        return beforeDeadline(deadline, operationId, outerSignal, async (signal) => {
            const existing = await lookup(settings, operationId, signal);
            if (existing)
                return Object.freeze({
                    funding: await reconcile(settings, existing, requirementKey, requirement.amount, signal),
                });
            return acquire(settings, {
                requirement,
                requirementKey,
                operationId,
                policy,
                deadline,
                signal,
            });
        });
    };
    return Object.freeze({
        name: 'cross-chain',
        enforcesFundingSpend: true,
        async recover(operationId, recovery = {}) {
            assertOperationId(operationId);
            const { deadlineSeconds } = resolvePolicy({ deadlineSeconds: recovery.deadlineSeconds });
            return beforeDeadline(nowSeconds() + deadlineSeconds, operationId, recovery.signal, async (signal) => {
                const operation = await lookup(settings, operationId, signal);
                if (!operation)
                    throw new FundingError('Unknown funding operation');
                return reconcile(settings, operation, operation.requirementKey, operation.request.amountOut, signal);
            });
        },
        async ensureBalance(topUp) {
            const { minimum, target, operationId } = topUp;
            if (typeof minimum !== 'bigint' ||
                typeof target !== 'bigint' ||
                minimum < 0n ||
                target < minimum)
                throw new InvalidConfigurationError('Invalid balance replenishment settings');
            assertOperationId(operationId);
            // Replenishment is not a payment, so a payment ceiling here would be silently meaningless.
            if (Object.hasOwn(topUp, 'maxPayment'))
                throw new InvalidConfigurationError('ensureBalance cannot include maxPayment');
            const policy = resolvePolicy(topUp);
            const signal = topUp.signal ?? neverAborted;
            signal.throwIfAborted();
            // An existing operation must be reconciled even if an unrelated deposit raised the balance.
            const existing = await settings.store.get(operationId);
            if (!existing && (await readBalance(settings.balance, to)) >= minimum)
                return undefined;
            const prepared = await fund({
                protocol: 'funding',
                method: 'balance',
                intent: 'fund',
                network: to.network,
                asset: to.asset,
                amount: target,
            }, policy, operationId, signal);
            return prepared.funding;
        },
        resolve(requirement) {
            if (!matchesDestination(requirement, to))
                return undefined;
            return Object.freeze({
                ...requirement,
                asset: to.asset,
                currency: to.currency,
                decimals: to.decimals,
            });
        },
        async prepare(requirement, context) {
            // Funds delivered to an account that will not sign the payment cannot pay for it.
            if (!isPayer(context.payer, to.owner))
                throw new InvalidConfigurationError('Cross-chain destination account is not the payer');
            return fund(requirement, context.policy, context.operationId, context.signal);
        },
    });
}
/** Reads a saved operation; a result arriving after cancellation is never inspected. */
async function lookup(settings, operationId, signal) {
    const operation = await settings.store.get(operationId);
    signal.throwIfAborted();
    return operation;
}
/**
 * Waits for a saved operation without quoting or submitting, then independently confirms that the
 * destination holds at least `requiredBalance`.
 */
async function reconcile(settings, operation, requirementKey, requiredBalance, signal) {
    assertOperation(operation, requirementKey, settings);
    const route = settings.routes.find((route) => route.name === operation.route);
    if (!route)
        throw recoveryError(operation.id, operation.reference);
    const settlement = await settleOperation({
        operation,
        route,
        store: settings.store,
        signal,
        submit: false,
        pollIntervalMs: settings.pollIntervalMs,
    });
    return confirm(settings, operation, settlement, requiredBalance, signal);
}
/** Quotes every route for the destination shortfall, then claims and settles the cheapest. */
async function acquire(settings, attempt) {
    const { from, to } = settings;
    const { requirement, operationId, policy, signal } = attempt;
    const balance = await readBalance(settings.balance, to);
    if (balance >= requirement.amount)
        return Object.freeze({ funding: availableReceipt(to.network, to.asset, requirement.amount) });
    const request = Object.freeze({
        amountOut: requirement.amount - balance,
        deadline: attempt.deadline,
        from,
        maxSlippageBps: policy.maxSlippageBps,
        operationId,
        signal,
        to,
    });
    const selected = await selectQuote(settings, request, policy.maxFundingSpend);
    signal.throwIfAborted();
    const { signal: _signal, ...savedRequest } = request;
    const operation = immutableSnapshot({
        id: operationId,
        route: selected.route.name,
        requirementKey: attempt.requirementKey,
        request: savedRequest,
        quote: selected.quote,
    });
    let claimed;
    try {
        claimed = await settings.store.claim(operation);
    }
    catch (cause) {
        // The write may have landed even though it reported failure.
        throw recoveryError(operationId, undefined, { cause });
    }
    if (!claimed)
        throw recoveryError(operationId, undefined);
    const settlement = await settleOperation({
        operation,
        route: selected.route,
        store: settings.store,
        signal,
        submit: true,
        pollIntervalMs: settings.pollIntervalMs,
    });
    return Object.freeze({
        funding: await confirm(settings, operation, settlement, requirement.amount, signal),
    });
}
/** Accepts provider completion only once the destination balance independently covers the need. */
async function confirm(settings, operation, settlement, requiredBalance, signal) {
    const { from, to } = settings;
    const { reference } = settlement;
    signal.throwIfAborted();
    let balance;
    try {
        balance = await readBalance(settings.balance, to);
    }
    catch (cause) {
        throw recoveryError(operation.id, reference, { cause });
    }
    if (balance < requiredBalance)
        throw recoveryError(operation.id, reference, {
            message: `Cross-chain confirmation did not acquire the required balance; reconcile operation ${operation.id} before retrying`,
        });
    return acquiredReceipt({
        route: operation.route,
        input: {
            network: from.network,
            asset: from.asset,
            quotedAmount: operation.quote.amountIn,
            amount: settlement.amountIn,
        },
        output: { network: to.network, asset: to.asset, amount: operation.request.amountOut },
        reference,
    });
}
async function selectQuote(settings, request, limits) {
    const { results, failures } = await settleConcurrent(settings.routes, settings.concurrency, async (route) => {
        const quote = immutableSnapshot(await quoteRoute(route, request, settings.timeoutMs));
        return validQuote(quote, request) && validGuarantees(quote, request, route, limits)
            ? { quote, route }
            : undefined;
    });
    // Quotes may expire while slower routes finish. The first configured route wins ties.
    const selected = results
        .filter(({ quote }) => validQuote(quote, request))
        .reduce((best, candidate) => !best || candidate.quote.amountIn < best.quote.amountIn ? candidate : best, undefined);
    if (!selected)
        throw new NoRouteError('No trusted cross-chain route can fund the payment', {
            cause: failureCause(failures, 'Cross-chain quote failures'),
        });
    return selected;
}
function validQuote(quote, request) {
    return (isRecord(quote) &&
        typeof quote.amountIn === 'bigint' &&
        quote.amountIn > 0n &&
        isText(quote.reference) &&
        Number.isSafeInteger(quote.expiresAt) &&
        Math.min(quote.expiresAt, request.deadline) > nowSeconds());
}
function quoteRoute(route, request, timeoutMs) {
    return withTimeout(async (signal) => route.quote(Object.freeze({ ...request, signal })), {
        milliseconds: Math.min(timeoutMs, untilDeadline(request.deadline)),
        signal: request.signal,
        timeoutError: () => new FundingError(`Cross-chain route ${route.name} quote timed out`),
    });
}
/**
 * Bounds funding work by its deadline. Expiry and cancellation raise FundingRecoveryError so the
 * caller reconciles instead of retrying blindly.
 */
function beforeDeadline(deadline, operationId, signal, run) {
    return withTimeout(run, {
        milliseconds: untilDeadline(deadline),
        signal,
        timeoutError: () => recoveryError(operationId, undefined, {
            message: `Cross-chain funding timed out; reconcile operation ${operationId} before retrying`,
        }),
        abortError: (cause) => recoveryError(operationId, undefined, { cause }),
    });
}
function matchesDestination(requirement, to) {
    return assetKey(requirement) === assetKey(to);
}
/** Encodes payment terms unambiguously; network and resource values themselves contain colons. */
function requirementKeyOf(requirement) {
    const { network } = requirement;
    return JSON.stringify([
        requirement.protocol,
        requirement.method,
        requirement.intent,
        network,
        canonicalIdentifier(network, requirement.asset),
        requirement.amount.toString(),
        canonicalIdentifier(network, requirement.recipient) ?? null,
        requirement.resource ?? null,
    ]);
}
function assertOperationId(operationId) {
    if (typeof operationId !== 'string' || !operationId.trim())
        throw new InvalidConfigurationError('Cross-chain operation ID must be a non-empty string');
}
function settingsOf(options) {
    const { operations: store, routes } = options;
    if (!isRecord(store) ||
        typeof store.get !== 'function' ||
        typeof store.claim !== 'function' ||
        typeof store.setReference !== 'function')
        throw new InvalidConfigurationError('A durable operation store is required');
    if (options.pollIntervalMs !== undefined && !isPositive(options.pollIntervalMs))
        throw new InvalidConfigurationError('pollIntervalMs must be positive');
    if (!Array.isArray(routes) || routes.length === 0)
        throw new InvalidConfigurationError('At least one trusted cross-chain route is required');
    assertQuoteOptions(options);
    const names = new Set();
    for (const route of routes) {
        if (!isRecord(route) || typeof route.name !== 'string' || !route.name.trim())
            throw new InvalidConfigurationError('Cross-chain route name must be a non-empty string');
        if (names.has(route.name))
            throw new InvalidConfigurationError(`Duplicate cross-chain route: ${route.name}`);
        if (typeof route.quote !== 'function' ||
            typeof route.submit !== 'function' ||
            typeof route.status !== 'function')
            throw new InvalidConfigurationError(`Cross-chain route ${route.name} must implement quote, submit, and status`);
        names.add(route.name);
    }
    const reader = routes.find((route) => typeof route.balance === 'function');
    const balance = options.balance ?? reader?.balance.bind(reader);
    if (typeof balance !== 'function')
        throw new InvalidConfigurationError('A destination balance reader is required');
    return Object.freeze({
        from: accountSnapshot(options.from),
        to: accountSnapshot(options.to),
        routes: Object.freeze(routes.map(routeSnapshot)),
        store,
        balance,
        concurrency: options.concurrency ?? defaultConcurrency,
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
        pollIntervalMs: options.pollIntervalMs ?? defaultPollIntervalMs,
    });
}
function accountSnapshot(account) {
    if (!Number.isSafeInteger(account?.chainId) || account.chainId <= 0)
        throw new InvalidConfigurationError('Funding account chainId must be a positive safe integer');
    if (account.network !== `eip155:${account.chainId}`)
        throw new InvalidConfigurationError('Funding account network must match chainId');
    if (!isEvmAddress(account.owner) || !isEvmAddress(account.asset))
        throw new InvalidConfigurationError('Funding account and asset must be EVM addresses');
    if (typeof account.currency !== 'string' || !account.currency.trim())
        throw new InvalidConfigurationError('Funding account currency must be a non-empty string');
    if (!isTokenDecimals(account.decimals))
        throw new InvalidConfigurationError('Funding account decimals must be an integer from 0 to 255');
    return Object.freeze({ ...account });
}
function routeSnapshot(route) {
    return Object.freeze({
        ...route,
        quote: route.quote.bind(route),
        submit: route.submit.bind(route),
        status: route.status.bind(route),
    });
}
function assertOperation(operation, requirementKey, { from, to }) {
    const sameAccount = (account, expected) => assetKey(account) === assetKey(expected) &&
        account.owner.toLowerCase() === expected.owner.toLowerCase();
    if (operation.requirementKey !== requirementKey ||
        !sameAccount(operation.request.from, from) ||
        !sameAccount(operation.request.to, to))
        throw new InvalidConfigurationError('Operation ID belongs to a different funding intent');
}
function validGuarantees(quote, request, route, limits) {
    const { amountOut, minAmountOut, maxAmountIn, fees } = quote;
    if (typeof amountOut !== 'bigint' ||
        typeof minAmountOut !== 'bigint' ||
        minAmountOut < request.amountOut ||
        amountOut < minAmountOut)
        return false;
    // Estimates are saved like bounded quotes, so optional bounds must still be well-formed.
    if (route.executionMode === 'provider-managed')
        return (limits === undefined &&
            (maxAmountIn === undefined || typeof maxAmountIn === 'bigint') &&
            (fees === undefined || validFees(fees)));
    if (typeof maxAmountIn !== 'bigint' ||
        maxAmountIn < quote.amountIn ||
        maxAmountIn > addSlippage(quote.amountIn, request.maxSlippageBps) ||
        !validFees(fees))
        return false;
    const source = assetKey(request.from);
    const debits = [{ ...request.from, amount: maxAmountIn }];
    for (const fee of fees) {
        if (!fee.includedInAmountIn)
            debits.push(fee);
        else if (assetKey(fee) !== source || fee.amount > maxAmountIn)
            return false;
    }
    if (!limits)
        return true;
    const totals = new Map();
    for (const debit of debits)
        totals.set(assetKey(debit), (totals.get(assetKey(debit)) ?? 0n) + debit.amount);
    return [...totals].every(([key, amount]) => limits.some((limit) => assetKey(limit) === key && amount <= limit.amount));
}
function validFees(fees) {
    return (Array.isArray(fees) &&
        fees.every((fee) => isRecord(fee) &&
            isText(fee.network) &&
            isText(fee.asset) &&
            typeof fee.amount === 'bigint' &&
            fee.amount >= 0n &&
            typeof fee.includedInAmountIn === 'boolean' &&
            (fee.kind === 'provider' || fee.kind === 'gas')));
}
async function readBalance(read, account) {
    const balance = await read(account);
    if (typeof balance !== 'bigint' || balance < 0n)
        throw new FundingError('Destination balance must be a non-negative bigint');
    return balance;
}
function isText(value) {
    return typeof value === 'string' && value !== '';
}
