import { FundingError, FundingRecoveryError, InvalidConfigurationError } from '../core/errors.js';
import { nowSeconds, sleep, untilDeadline } from '../core/time.js';
import { isEvmAddress, isPositive, isRecord } from '../core/validate.js';
import { evmRoute } from '../funders/evm.js';
/**
 * Creates an estimate-only, exact-output EVM route executed as a Privy wallet action. The request's
 * `operationId` is Privy's idempotency key, so retrying an operation resumes its action rather than
 * swapping again. Once Privy execution may have started, failures are `FundingRecoveryError`s for
 * the operation, with the wallet-action ID as `reference` when it is known.
 */
export function privyEvmRoute(options) {
    const configured = validateOptions(options);
    return evmRoute({
        name: 'privy',
        executionMode: 'provider-managed',
        async quote(request) {
            assertWallet(request.account, configured.wallet.address);
            const response = await configured.client
                .wallets()
                .swaps()
                .quote(configured.wallet.id, withAuthorization(configured.authorizationContext, sameChainSwapParameters(request)));
            const quote = parseQuote(response, sameChainTerms(request));
            return Object.freeze({
                amountIn: quote.amountIn,
                ...(quote.expiresAt === undefined ? {} : { expiresAt: quote.expiresAt }),
            });
        },
        async execute(request) {
            assertWallet(request.account, configured.wallet.address);
            const parameters = withAuthorization(configured.authorizationContext, {
                ...sameChainSwapParameters(request),
                idempotency_key: idempotencyKey(request.operationId),
            });
            const swaps = configured.client.wallets().swaps();
            assertSubmittable(request);
            // From here on Privy may have started the swap, so every failure requires recovery.
            let actionId;
            try {
                const action = parseAction(await swaps.execute(configured.wallet.id, parameters));
                validateActionIdentity(action, configured.wallet.id);
                actionId = action.id;
            }
            catch (cause) {
                throw new FundingRecoveryError(request.operationId, { cause });
            }
            try {
                const completed = await waitForAction(configured, actionId, request.deadline, request.signal);
                const amounts = validateAction(completed, sameChainTerms(request));
                return Object.freeze({ amountIn: amounts.amountIn, reference: actionId });
            }
            catch (cause) {
                throw new FundingRecoveryError(request.operationId, { cause, reference: actionId });
            }
        },
    });
}
/**
 * Creates a resumable, estimate-only Privy route for cross-network exact-output funding. The
 * request ID is Privy's idempotency key, and every accepted wallet action, even a failed one, is
 * returned for persistence so its status is reconciled rather than resubmitted.
 */
export function privyCrossChainRoute(options) {
    const configured = validateOptions(options);
    return Object.freeze({
        name: 'privy',
        executionMode: 'provider-managed',
        async quote(request) {
            assertWallet(request.from.owner, configured.wallet.address);
            const response = await configured.client
                .wallets()
                .swaps()
                .quote(configured.wallet.id, withAuthorization(configured.authorizationContext, swapParameters(request)));
            const quote = parseQuote(response, operationTerms(request));
            return Object.freeze({
                amountIn: quote.amountIn,
                amountOut: quote.amountOut,
                minAmountOut: quote.minAmountOut,
                expiresAt: Math.min(quote.expiresAt ?? request.deadline, request.deadline),
                reference: request.operationId,
            });
        },
        async submit({ request }) {
            assertWallet(request.from.owner, configured.wallet.address);
            const parameters = withAuthorization(configured.authorizationContext, {
                ...swapParameters(request),
                idempotency_key: idempotencyKey(request.operationId),
            });
            const swaps = configured.client.wallets().swaps();
            assertSubmittable(request);
            const action = parseAction(await swaps.execute(configured.wallet.id, parameters));
            validateActionIdentity(action, configured.wallet.id);
            return Object.freeze({ reference: action.id });
        },
        async status(operation, { signal }) {
            signal.throwIfAborted();
            if (!operation.reference)
                throw new FundingError(`Privy action ID is unavailable for operation ${operation.id}; reconcile it in Privy`);
            const action = parseAction(await configured.client.wallets().actions.get(operation.reference, {
                wallet_id: configured.wallet.id,
            }));
            validateActionIdentity(action, configured.wallet.id, operation.reference);
            if (action.status === 'pending')
                return Object.freeze({ status: 'pending' });
            if (action.status !== 'succeeded')
                return Object.freeze({ status: 'actionRequired' });
            const amounts = validateAction(action, operationTerms(operation.request));
            return Object.freeze({
                status: 'completed',
                amountIn: amounts.amountIn,
                amountOut: amounts.amountOut,
            });
        },
    });
}
function validateOptions(value) {
    if (typeof value.wallet.id !== 'string' || !value.wallet.id.trim())
        throw new InvalidConfigurationError('Privy wallet ID is required');
    if (!isEvmAddress(value.wallet.address))
        throw new InvalidConfigurationError('Privy wallet address must be an EVM address');
    if (value.pollIntervalMs !== undefined && !isPositive(value.pollIntervalMs))
        throw new InvalidConfigurationError('pollIntervalMs must be positive');
    return Object.freeze({ ...value, wallet: Object.freeze({ ...value.wallet }) });
}
/** An empty key would let Privy treat a retry as a new swap. */
function idempotencyKey(id) {
    if (typeof id !== 'string' || !id.trim())
        throw new InvalidConfigurationError('Privy idempotency key must be a non-empty string');
    return id;
}
/**
 * Checked synchronously immediately before Privy execute, so no await lets cancellation or the
 * deadline pass in between.
 */
function assertSubmittable(request) {
    request.signal.throwIfAborted();
    if (request.deadline <= nowSeconds())
        throw new FundingError('Privy swap deadline expired before execution');
}
function withAuthorization(authorizationContext, value) {
    return authorizationContext
        ? Object.freeze({ ...value, authorization_context: authorizationContext })
        : Object.freeze(value);
}
/** Same-chain exact-output swap with policy slippage. */
function sameChainSwapParameters(request) {
    const network = `eip155:${request.chainId}`;
    return {
        base_amount: request.amountOut.toString(),
        amount_type: 'exact_output',
        source: { asset_address: request.tokenIn.address, caip2: network },
        destination: { asset_address: request.tokenOut.address, caip2: network },
        slippage_bps: request.maxSlippageBps,
    };
}
function sameChainTerms(request) {
    const network = `eip155:${request.chainId}`;
    return {
        amountOut: request.amountOut,
        fromAsset: request.tokenIn.address,
        fromNetwork: network,
        toAsset: request.tokenOut.address,
        toNetwork: network,
    };
}
function swapParameters(request) {
    return {
        base_amount: request.amountOut.toString(),
        amount_type: 'exact_output',
        source: { asset_address: request.from.asset, caip2: request.from.network },
        destination: {
            asset_address: request.to.asset,
            caip2: request.to.network,
            destination_address: request.to.owner,
        },
        slippage_bps: request.maxSlippageBps,
    };
}
function operationTerms(request) {
    return {
        amountOut: request.amountOut,
        fromAsset: request.from.asset,
        fromNetwork: request.from.network,
        toAsset: request.to.asset,
        toNetwork: request.to.network,
    };
}
function parseQuote(response, terms) {
    if (!isRecord(response))
        throw new FundingError('Invalid Privy quote');
    const amountIn = parseAmount(response.input_amount, 'input amount');
    const amountOut = parseAmount(response.est_output_amount, 'estimated output amount');
    const minAmountOut = parseAmount(response.minimum_output_amount, 'minimum output amount');
    if (response.caip2 !== terms.fromNetwork ||
        !sameDestinationNetwork(response.destination_caip2, terms) ||
        !sameAsset(response.input_token, terms.fromAsset) ||
        !sameAsset(response.output_token, terms.toAsset) ||
        minAmountOut < terms.amountOut ||
        amountOut < minAmountOut)
        throw new FundingError('Privy quote does not match the requested exact output');
    let expiresAt;
    if (response.expires_at !== undefined) {
        if (
        // Stryker disable next-line ConditionalExpression: Number.isSafeInteger also rejects non-numbers; typeof only narrows the type
        typeof response.expires_at !== 'number' ||
            !Number.isSafeInteger(response.expires_at) ||
            response.expires_at <= nowSeconds())
            throw new FundingError('Privy quote expiry is invalid');
        expiresAt = response.expires_at;
    }
    return { amountIn, amountOut, minAmountOut, expiresAt };
}
function validateAction(action, terms) {
    if (action.type !== 'swap' ||
        // Stryker disable next-line ConditionalExpression: both callers pass only succeeded actions
        action.status !== 'succeeded' ||
        action.caip2 !== terms.fromNetwork ||
        !sameDestinationNetwork(action.destination_caip2, terms) ||
        !sameAsset(action.input_token, terms.fromAsset) ||
        !sameAsset(action.output_token, terms.toAsset))
        throw new FundingError('Privy action does not match the funding operation');
    const amountIn = parseAmount(action.input_amount, 'actual input amount');
    const amountOut = parseAmount(action.output_amount, 'actual output amount');
    if (amountOut < terms.amountOut)
        throw new FundingError('Privy action delivered less than the requested exact output');
    return { amountIn, amountOut };
}
function validateActionIdentity(action, walletId, actionId) {
    if (typeof action.id !== 'string' ||
        !action.id.trim() ||
        action.wallet_id !== walletId ||
        (actionId !== undefined && action.id !== actionId))
        throw new FundingError('Privy action does not match the configured wallet or action ID');
}
async function waitForAction(options, actionId, deadline, signal) {
    while (true) {
        signal.throwIfAborted();
        if (deadline <= nowSeconds())
            throw new FundingError('Privy swap confirmation timed out');
        const action = parseAction(await options.client.wallets().actions.get(actionId, {
            wallet_id: options.wallet.id,
        }));
        validateActionIdentity(action, options.wallet.id, actionId);
        if (action.status !== 'pending') {
            if (action.status !== 'succeeded')
                throw new FundingError(`Privy swap was ${action.status}`);
            return action;
        }
        await sleep(Math.min(options.pollIntervalMs ?? 1_000, untilDeadline(deadline)), signal);
    }
}
function assertWallet(actual, expected) {
    if (actual.toLowerCase() !== expected.toLowerCase())
        throw new FundingError('Privy wallet does not match the funding account');
}
function parseAmount(value, label) {
    if (typeof value !== 'string' || !/^\d+$/.test(value))
        throw new FundingError(`Privy ${label} is invalid`);
    const amount = BigInt(value);
    if (amount <= 0n)
        throw new FundingError(`Privy ${label} must be positive`);
    return amount;
}
function parseAction(value) {
    if (!isRecord(value))
        throw new FundingError('Invalid Privy wallet action');
    return value;
}
function sameAsset(actual, expected) {
    return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}
function sameDestinationNetwork(actual, terms) {
    return terms.fromNetwork === terms.toNetwork
        ? actual === undefined || actual === terms.toNetwork
        : actual === terms.toNetwork;
}
