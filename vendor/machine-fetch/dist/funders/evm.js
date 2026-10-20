import { erc20Abi, getAddress } from 'viem';
import { readContract } from 'viem/actions';
import { defineToken } from 'viem/tokens';
import { failureCause, settleConcurrent } from '../core/concurrent.js';
import { FundingError, FundingRecoveryError, InsufficientFundsError, InvalidConfigurationError, NoRouteError, } from '../core/errors.js';
import { addSlippage } from '../core/policy.js';
import { acquiredReceipt, availableReceipt } from '../core/receipt.js';
import { nowSeconds, untilDeadline, withTimeout } from '../core/time.js';
import { assertQuoteOptions, assetKey, isEvmAddress, isEvmNetwork, isPayer, isTokenDecimals, } from '../core/validate.js';
const defaultConcurrency = 4;
const defaultTimeoutMs = 10_000;
const executionModes = ['bounded', 'provider-managed'];
/** Validates a caller-owned route and returns a frozen snapshot of its route fields. */
export function evmRoute(route) {
    if (typeof route.name !== 'string' || !route.name.trim())
        throw new InvalidConfigurationError('EVM route name must be a non-empty string');
    if (route.executionMode !== undefined && !executionModes.includes(route.executionMode))
        throw new InvalidConfigurationError('EVM route executionMode must be bounded or provider-managed');
    if (typeof route.quote !== 'function' || typeof route.execute !== 'function')
        throw new InvalidConfigurationError('EVM route quote and execute must be functions');
    return Object.freeze({
        // Reads prototype getters too, so class-based routes keep their name.
        name: route.name,
        executionMode: route.executionMode ?? 'bounded',
        quote: route.quote.bind(route),
        execute: route.execute.bind(route),
    });
}
/**
 * Creates a funder that acquires exact EVM payment assets through caller-trusted routes. It does
 * not enforce `maxFundingSpend`, so payment funding rejects that policy before calling it.
 */
export function evmFunder(options) {
    validateOptions(options);
    const configured = optionsSnapshot(options);
    // One settled tail per chain and account; the set of keys is bounded by the configured accounts.
    const locks = new Map();
    return Object.freeze({
        name: 'evm',
        resolve(requirement) {
            const resolved = resolveRequirement(requirement, configured.outputs);
            if (!resolved)
                return undefined;
            return Object.freeze({
                ...requirement,
                asset: resolved.token.address,
                decimals: resolved.token.decimals,
                ...(resolved.token.currency ? { currency: resolved.token.currency } : {}),
            });
        },
        async prepare(requirement, context) {
            context.signal.throwIfAborted();
            const resolved = resolveRequirement(requirement, configured.outputs);
            if (!resolved)
                throw new InvalidConfigurationError('EVM payment token is not configured');
            const client = await configured.client(resolved.chainId);
            if (!client)
                throw new InvalidConfigurationError(`No Viem client configured for chain ${resolved.chainId}`);
            const account = configured.account ?? client.account?.address;
            if (!account)
                throw new InvalidConfigurationError('An EVM account address is required');
            // Funds acquired by an account that will not sign the payment cannot pay for it.
            if (!isPayer(context.payer, account))
                throw new InvalidConfigurationError('EVM funding account is not the payer');
            // Stryker disable next-line MethodExpression: any consistent case fold yields equal lock keys
            const key = `${resolved.chainId}:${account.toLowerCase()}`;
            return withLock(locks, key, () => acquire({ options: configured, context, client, account, requirement, resolved }));
        },
    });
}
/** Checks the target balance, then acquires only the shortfall through the cheapest live route. */
async function acquire(acquisition) {
    const { options, context, client, account, requirement, resolved } = acquisition;
    context.signal.throwIfAborted();
    const deadline = nowSeconds() + context.policy.deadlineSeconds;
    const targetBalance = await balanceOf(options, client, account, resolved.token);
    if (targetBalance >= requirement.amount)
        return Object.freeze({
            funding: availableReceipt(requirement.network, resolved.token.address, requirement.amount),
        });
    const amountOut = requirement.amount - targetBalance;
    const selected = await selectCandidate(acquisition, amountOut, deadline);
    const result = await selected.route.execute(Object.freeze({
        account,
        operationId: context.operationId,
        chainId: resolved.chainId,
        client,
        tokenIn: selected.tokenIn,
        tokenOut: resolved.token,
        amountOut,
        maxSlippageBps: context.policy.maxSlippageBps,
        quote: selected.quote,
        maxAmountIn: selected.maxAmountIn,
        deadline: Math.min(deadline, selected.quote.expiresAt ?? Number.POSITIVE_INFINITY),
        signal: context.signal,
    }));
    // The route has executed, so funds may have moved even if verification fails.
    const recovery = (detail) => new FundingRecoveryError(context.operationId, {
        ...detail,
        ...(result?.reference ? { reference: result.reference } : {}),
    });
    const fundedBalance = await balanceOf(options, client, account, resolved.token).catch((cause) => {
        throw recovery({ cause });
    });
    if (fundedBalance < requirement.amount)
        throw recovery({
            message: `Route completed without acquiring the required payment balance; reconcile operation ${context.operationId} before retrying`,
        });
    return Object.freeze({
        funding: acquiredReceipt({
            route: selected.route.name,
            input: {
                network: requirement.network,
                asset: selected.tokenIn.address,
                quotedAmount: selected.quote.amountIn,
                amount: result?.amountIn,
            },
            output: { network: requirement.network, asset: resolved.token.address, amount: amountOut },
            reference: result?.reference,
        }),
    });
}
/** Quotes every funded input against every route and returns the cheapest live candidate. */
async function selectCandidate(acquisition, amountOut, deadline) {
    const { options, context, client, account, resolved } = acquisition;
    const slippageBps = context.policy.maxSlippageBps;
    const jobs = (await fundedInputs(acquisition)).flatMap(({ balance, tokenIn }) => options.routes.map((route) => ({ balance, route, tokenIn })));
    const { results, failures } = await settleConcurrent(jobs, options.concurrency ?? defaultConcurrency, async ({ balance, route, tokenIn }) => {
        const quoted = await quoteRoute(route, {
            account,
            operationId: context.operationId,
            amountOut,
            chainId: resolved.chainId,
            client,
            deadline,
            maxSlippageBps: slippageBps,
            tokenIn,
            tokenOut: resolved.token,
        }, options.timeoutMs ?? defaultTimeoutMs, context.signal);
        if (!quoted)
            return undefined;
        const quote = Object.freeze(quoted);
        if (quote.amountIn <= 0n || !isLive(quote))
            return undefined;
        const maxAmountIn = addSlippage(quote.amountIn, slippageBps);
        return maxAmountIn <= balance ? { route, tokenIn, quote, maxAmountIn } : undefined;
    });
    context.signal.throwIfAborted();
    const preferred = isPreferred(currencyOf(resolved.token));
    // The first configured candidate wins ties.
    const selected = results
        .filter(({ quote }) => isLive(quote))
        .reduce((best, candidate) => (!best || preferred(candidate, best) ? candidate : best), undefined);
    if (!selected)
        throw new NoRouteError('No trusted route can acquire the required payment asset', {
            cause: failureCause(failures, 'Route quote failures'),
        });
    if (deadline <= nowSeconds())
        throw new FundingError('EVM funding deadline expired before route execution');
    return selected;
}
/** Returns configured inputs that are eligible under policy and currently hold a balance. */
async function fundedInputs(acquisition) {
    const { options, context, client, account, resolved } = acquisition;
    const target = resolved.token;
    const eligible = resolveTokens(options.inputs, resolved.chainId).filter((token) => token.address !== target.address &&
        (!context.policy.sameCurrencyOnly ||
            (!!token.currency && token.currency.toUpperCase() === target.currency?.toUpperCase())));
    if (eligible.length === 0)
        throw new NoRouteError('No eligible payment asset is configured');
    // Unlike quotes, a failed balance read fails the acquisition at once rather than one candidate.
    const funded = (await Promise.all(eligible.map(async (tokenIn) => ({
        balance: await balanceOf(options, client, account, tokenIn),
        tokenIn,
    })))).filter(({ balance }) => balance > 0n);
    if (funded.length === 0)
        throw new InsufficientFundsError('No configured payment asset has a balance');
    return funded;
}
function quoteRoute(route, parameters, timeoutMs, signal) {
    return withTimeout(async (routeSignal) => route.quote(Object.freeze({ ...parameters, signal: routeSignal })), {
        milliseconds: Math.min(timeoutMs, untilDeadline(parameters.deadline)),
        signal,
        timeoutError: () => new FundingError(`EVM route ${route.name} quote timed out`),
    });
}
function isLive(quote) {
    return quote.expiresAt === undefined || quote.expiresAt > nowSeconds();
}
async function balanceOf(options, client, account, token) {
    if (options.balance)
        return options.balance({ client, account, token });
    return readContract(client, {
        abi: erc20Abi,
        address: token.address,
        functionName: 'balanceOf',
        args: [account],
    });
}
function resolveRequirement(requirement, tokens) {
    const { network } = requirement;
    if (!isEvmNetwork(network))
        return undefined;
    const chainId = Number(network.slice('eip155:'.length));
    if (!Number.isSafeInteger(chainId))
        return undefined;
    const key = assetKey(requirement);
    const token = resolveTokens(tokens, chainId).find((candidate) => assetKey({ network, asset: candidate.address }) === key);
    return token ? { chainId, token } : undefined;
}
function resolveTokens(tokens, chainId) {
    return tokens.flatMap((token) => {
        const address = token.addresses[chainId];
        return address
            ? [
                Object.freeze({
                    address: getAddress(address),
                    decimals: token.decimals,
                    currency: token.currency,
                    name: token.name,
                    symbol: token.symbol,
                }),
            ]
            : [];
    });
}
/**
 * Whether `left` strictly precedes `right`: inputs in the target currency first, then other
 * currencies by code, then the lowest decimal-normalized input. Amounts are compared only within one
 * currency because no exchange rate is known.
 */
function isPreferred(targetCurrency) {
    return (left, right) => {
        const leftCurrency = currencyOf(left.tokenIn);
        const rightCurrency = currencyOf(right.tokenIn);
        if (leftCurrency !== rightCurrency) {
            if (leftCurrency === targetCurrency)
                return true;
            if (rightCurrency === targetCurrency)
                return false;
            // Stryker disable next-line EqualityOperator: the currencies differ here, so < and <= agree
            return leftCurrency < rightCurrency;
        }
        return (left.quote.amountIn * 10n ** BigInt(right.tokenIn.decimals) <
            right.quote.amountIn * 10n ** BigInt(left.tokenIn.decimals));
    };
}
function currencyOf(token) {
    return token.currency?.toUpperCase() ?? '';
}
async function withLock(locks, key, run) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    locks.set(key, tail);
    await previous;
    try {
        return await run();
    }
    finally {
        release();
    }
}
function validateOptions(options) {
    if (options.outputs.length === 0)
        throw new InvalidConfigurationError('At least one payment token is required');
    if (options.inputs.length === 0)
        throw new InvalidConfigurationError('At least one source token is required');
    if (options.routes.length === 0)
        throw new InvalidConfigurationError('At least one trusted route is required');
    assertQuoteOptions(options);
    for (const token of [...options.outputs, ...options.inputs]) {
        if (!isTokenDecimals(token.decimals))
            throw new InvalidConfigurationError('Token decimals must be an integer from 0 to 255');
        if (!Object.values(token.addresses).every(isEvmAddress))
            throw new InvalidConfigurationError('Token addresses must be EVM addresses');
    }
}
function optionsSnapshot(options) {
    return Object.freeze({
        ...options,
        outputs: Object.freeze(options.outputs.map(tokenSnapshot)),
        routes: Object.freeze(options.routes.map(evmRoute)),
        inputs: Object.freeze(options.inputs.map(tokenSnapshot)),
    });
}
function tokenSnapshot(token) {
    const snapshot = defineToken({
        addresses: Object.freeze({ ...token.addresses }),
        currency: token.currency,
        decimals: token.decimals,
        name: token.name,
        popular: token.popular,
        symbol: token.symbol,
    });
    // Viem tokens are callable; freezing in place keeps the call signature in the type.
    // Stryker disable next-line CallExpression: defense in depth; routes get resolved copies
    Object.freeze(snapshot);
    return snapshot;
}
