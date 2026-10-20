import { encodeFunctionData, erc20Abi, hashStruct, parseAbi, zeroAddress, } from 'viem';
import { estimateFeesPerGas, estimateGas, getBalance, getBlockNumber, getTransactionReceipt, prepareTransactionRequest, readContract, sendTransaction, waitForTransactionReceipt, } from 'viem/actions';
import { tempo } from 'viem/chains';
import { FundingError, InvalidConfigurationError } from '../core/errors.js';
import { nowSeconds, sleep, untilDeadline } from '../core/time.js';
import { isEvmAddress, isRecord } from '../core/validate.js';
/**
 * Tempo source transactions expire with their quote; 25 seconds is the longest validity Tempo
 * accepts for an expiring nonce. Other chains send calls one at a time, so their quotes last until
 * the request deadline and an approval is never cut off from its deposit.
 */
const tempoQuoteValiditySeconds = 25;
/** The chain registry is shared by every lookup, so its one request has its own bound. */
const registryTimeoutMs = 10_000;
/** Relay fills with one or a few transactions; more is malformed, not more RPC work. */
const maxDestinationHashes = 8;
/** A lagging destination RPC gets this many tries to reach the delivery block. */
const settledReadAttempts = 4;
const settledReadPauseMs = 250;
/**
 * Gas bound for a call that depends on an earlier one (a deposit after its approval) when the quote
 * gives none; it only sizes the declared fee, and signing still uses a fresh estimate.
 */
const dependentCallGas = 500000n;
/** Declared gas fees allow twice the estimated cost, so fee movement before signing still fits. */
const feeHeadroom = 2n;
/** Tempo gas prices are in attodollars; TIP-20 fee tokens have six decimals. */
const tempoFeeScale = 10n ** 12n;
const tempoSerializer = tempo.serializers.transaction;
const depositAbi = parseAbi([
    'function depositErc20(address depositor,address token,uint256 amount,bytes32 id)',
]);
const pendingStatuses = [
    'waiting',
    'depositing',
    'pending',
    'submitted',
    'delayed',
];
const hash32 = /^0x[\da-fA-F]{64}$/;
/** EIP-712 order types whose struct hash is Relay's order ID for EVM chains. */
const orderTypes = {
    Order: [
        { name: 'version', type: 'string' },
        { name: 'solverChainId', type: 'string' },
        { name: 'solver', type: 'address' },
        { name: 'salt', type: 'uint256' },
        { name: 'inputs', type: 'Input[]' },
        { name: 'output', type: 'Output' },
        { name: 'fees', type: 'Fee[]' },
    ],
    Input: [
        { name: 'payment', type: 'InputPayment' },
        { name: 'refunds', type: 'InputRefund[]' },
    ],
    InputPayment: [
        { name: 'chainId', type: 'string' },
        { name: 'currency', type: 'bytes' },
        { name: 'amount', type: 'uint256' },
        { name: 'weight', type: 'uint256' },
    ],
    InputRefund: [
        { name: 'chainId', type: 'string' },
        { name: 'recipient', type: 'bytes' },
        { name: 'currency', type: 'bytes' },
        { name: 'minimumAmount', type: 'uint256' },
        { name: 'deadline', type: 'uint32' },
        { name: 'extraData', type: 'bytes' },
    ],
    Output: [
        { name: 'chainId', type: 'string' },
        { name: 'payments', type: 'OutputPayment[]' },
        { name: 'deadline', type: 'uint32' },
        { name: 'calls', type: 'bytes[]' },
        { name: 'extraData', type: 'bytes' },
    ],
    OutputPayment: [
        { name: 'recipient', type: 'bytes' },
        { name: 'currency', type: 'bytes' },
        { name: 'minimumAmount', type: 'uint256' },
        { name: 'expectedAmount', type: 'uint256' },
    ],
    Fee: [
        { name: 'recipientChainId', type: 'string' },
        { name: 'recipient', type: 'bytes' },
        { name: 'currencyChainId', type: 'string' },
        { name: 'currency', type: 'bytes' },
        { name: 'amount', type: 'uint256' },
    ],
};
/** Validates clients by chain ID and returns a frozen copy. */
export function clientsOf(clients) {
    if (!isRecord(clients))
        throw new InvalidConfigurationError('Relay Protocol clients are invalid');
    for (const [chainId, client] of Object.entries(clients))
        if (!isRecord(client) || !isRecord(client.chain) || String(client.chain.id) !== chainId)
            throw new InvalidConfigurationError(`Relay Protocol client for chain ${chainId} must be a Viem client on that chain`);
    return Object.freeze({ ...clients });
}
/** Reads Relay's chain registry lazily; a failed read is retried by the next lookup. */
export function relayChains(fetch, url) {
    let registry;
    return async (chainId, signal) => {
        signal.throwIfAborted();
        // Shared by every lookup, so it runs under its own timeout; each caller stops waiting on abort.
        registry ??= loadChains(fetch, url, AbortSignal.timeout(registryTimeoutMs)).catch((cause) => {
            registry = undefined;
            throw cause;
        });
        let abort;
        const aborted = new Promise((_resolve, reject) => {
            abort = () => reject(signal.reason);
        });
        signal.addEventListener('abort', abort);
        let loaded;
        try {
            loaded = await Promise.race([registry, aborted]);
        }
        finally {
            // Long-lived signals would otherwise keep one listener per lookup.
            signal.removeEventListener('abort', abort);
        }
        const chain = loaded.get(chainId);
        if (!chain)
            throw new FundingError(`Relay Protocol does not list chain ${chainId}`);
        return chain;
    };
}
async function loadChains(fetch, url, signal) {
    const response = await fetch(`${url}/chains`, { signal });
    if (!response.ok)
        throw new FundingError(`Relay Protocol chain request failed with HTTP ${response.status}`);
    const body = await response.json();
    check(isRecord(body) && Array.isArray(body.chains), 'Relay Protocol chain registry is malformed');
    const registry = new Map();
    for (const chain of body.chains) {
        const v2 = isRecord(chain) && isRecord(chain.protocol) ? chain.protocol.v2 : undefined;
        // Lookups use numeric chain IDs, so entries keyed any other way are never found.
        if (isRecord(v2) &&
            typeof v2.chainId === 'string' &&
            typeof v2.depository === 'string' &&
            isEvmAddress(v2.depository))
            registry.set(chain.id, { name: v2.chainId, depository: v2.depository });
    }
    return registry;
}
/**
 * Verifies a quote's executable steps against the request and returns only locally reconstructed
 * calls. Contract deposits must carry an order whose recomputed ID, input, output, and refunds
 * match the request; deposit-address quotes must be one exact token transfer.
 */
export async function relayCalls(viem, quote, request) {
    const amount = BigInt(quote.details.currencyIn.amount);
    if (viem.useDepositAddress)
        return { calls: depositAddressCalls(quote, request, amount), deadline: request.deadline };
    const [from, to] = await Promise.all([
        viem.chains(request.from.chainId, request.signal),
        viem.chains(request.to.chainId, request.signal),
    ]);
    const { orderId, deadline } = verifiedOrder(quote, request, amount, from, to);
    const calls = [];
    for (const step of quote.steps)
        for (const item of step.items ?? []) {
            const tx = item.data;
            check(step.kind === 'transaction' &&
                tx !== undefined &&
                tx.chainId === request.from.chainId &&
                same(tx.from, request.from.owner) &&
                (tx.value === undefined || tx.value === '0') &&
                typeof tx.data === 'string' &&
                typeof tx.to === 'string', 'Relay Protocol step is not a source transaction from the funding account');
            const gas = gasHint(tx.gas);
            if (same(tx.to, request.from.asset)) {
                const approval = encodeFunctionData({
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [from.depository, amount],
                });
                check(same(tx.data, approval), 'Relay Protocol approval is not exactly the quoted input');
                calls.push({ to: request.from.asset, data: approval, value: 0n, gas });
            }
            else {
                const deposit = encodeFunctionData({
                    abi: depositAbi,
                    args: [request.from.owner, request.from.asset, amount, orderId],
                });
                check(same(tx.to, from.depository) && same(tx.data, deposit), 'Relay Protocol deposit does not match the verified order');
                calls.push({ to: from.depository, data: deposit, value: 0n, gas });
            }
        }
    check(calls.length <= 2 &&
        calls.filter((call) => call.to === from.depository).length === 1 &&
        calls.at(-1).to === from.depository, 'Relay Protocol steps must be at most one approval followed by one deposit');
    return { calls, deadline: Math.min(request.deadline, deadline) };
}
function depositAddressCalls(quote, request, amount) {
    // Quote parsing guarantees a step carrying the request ID.
    const [step, ...others] = quote.steps;
    const tx = step.items?.length === 1 ? step.items[0].data : undefined;
    const { depositAddress } = step;
    check(others.length === 0 &&
        tx !== undefined &&
        // Quote parsing already rejects a non-string address.
        isEvmAddress(depositAddress), 'Relay Protocol deposit address quote must be one transfer');
    const transfer = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [depositAddress, amount],
    });
    check(tx.chainId === request.from.chainId &&
        same(tx.from, request.from.owner) &&
        same(tx.to, request.from.asset) &&
        (tx.value === undefined || tx.value === '0') &&
        same(tx.data, transfer), 'Relay Protocol deposit address transfer does not match the quote');
    return [{ to: request.from.asset, data: transfer, value: 0n, gas: gasHint(tx.gas) }];
}
/** Recomputes the order ID and checks the order pays exactly this request's accounts. */
function verifiedOrder(quote, request, amount, from, to) {
    const protocol = isRecord(quote.protocol) ? quote.protocol.v2 : undefined;
    check(isRecord(protocol), 'Relay Protocol quote has no order');
    // Provider order data is untrusted; any shape error below is a malformed order.
    try {
        const order = protocol.orderData;
        const [input, ...inputs] = order.inputs;
        const [output, ...outputs] = order.output.payments;
        check(inputs.length === 0 &&
            outputs.length === 0 &&
            order.output.calls.length === 0 &&
            order.fees.length === 0, 'Relay Protocol order has unexpected inputs, outputs, calls, or fees');
        check(input?.payment.chainId === from.name &&
            same(input.payment.currency, request.from.asset) &&
            BigInt(input.payment.amount) === amount, 'Relay Protocol order input does not match the quote');
        check(order.output.chainId === to.name &&
            output !== undefined &&
            same(output.recipient, request.to.owner) &&
            same(output.currency, request.to.asset) &&
            BigInt(output.minimumAmount) >= request.amountOut &&
            Number.isSafeInteger(order.output.deadline) &&
            order.output.deadline > nowSeconds(), 'Relay Protocol order output does not pay the destination account');
        for (const refund of input.refunds) {
            const account = refund.chainId === from.name
                ? request.from
                : refund.chainId === to.name
                    ? request.to
                    : undefined;
            check(account !== undefined &&
                same(refund.recipient, account.owner) &&
                same(refund.currency, account.asset), 'Relay Protocol order refunds an unexpected account');
        }
        const orderId = hashStruct({ types: orderTypes, primaryType: 'Order', data: order });
        check(same(protocol.orderId, orderId), 'Relay Protocol order ID does not match its order');
        check(isRecord(protocol.paymentDetails) &&
            same(protocol.paymentDetails.depository, from.depository), 'Relay Protocol order pays an unexpected depository');
        return { orderId, deadline: order.output.deadline };
    }
    catch (cause) {
        if (cause instanceof FundingError)
            throw cause;
        throw new FundingError('Relay Protocol order is malformed', { cause });
    }
}
/**
 * Default `guarantees`: verifies the steps, then bounds gas by twice the estimated cost of every
 * source transaction, priced in the asset the source chain charges.
 */
export async function viemGuarantees(viem, { quote, request }) {
    const { calls, deadline } = await relayCalls(viem, quote, request);
    const client = clientFor(viem.clients, request.from.chainId);
    const account = request.from.owner;
    const tempoChain = isTempo(client);
    let gas = 0n;
    if (tempoChain && calls.some((call) => call.gas === undefined))
        // Tempo sends every call as one transaction, so the approval is in effect when the deposit runs.
        gas = await estimateGas(client, {
            account,
            calls: calls.map(withoutGas),
            feeToken: feeAsset(client, request),
        });
    else
        for (const [index, call] of calls.entries()) {
            // A later call depends on the approval before it, which estimation cannot see.
            gas +=
                call.gas ??
                    (index === 0
                        ? await estimateGas(client, { account, ...withoutGas(call) })
                        : dependentCallGas);
        }
    const { maxFeePerGas } = await estimateFeesPerGas(client);
    const fee = {
        kind: 'gas',
        network: request.from.network,
        asset: feeAsset(client, request),
        amount: feeAmount(client, gas * maxFeePerGas * feeHeadroom),
        includedInAmountIn: false,
    };
    return {
        maxAmountIn: BigInt(quote.details.currencyIn.amount),
        fees: [fee],
        expiresAt: tempoChain ? Math.min(deadline, nowSeconds() + tempoQuoteValiditySeconds) : deadline,
    };
}
/**
 * Default `submit`: signs the reconstructed calls with the source client. Before each signature,
 * the prepared gas limit and fee cap must fit in the declared gas fee, so no signed transaction can
 * spend more than the quote allows. Tempo calls are one atomic transaction that expires with the
 * quote.
 */
export async function viemSubmit(viem, { quote, limits, request, }) {
    const { calls } = await relayCalls(viem, quote, request);
    const client = signer(viem, request);
    const tempoChain = isTempo(client);
    const asset = feeAsset(client, request);
    let budget = limits.fees
        .filter((fee) => fee.kind === 'gas' && fee.network === request.from.network && same(fee.asset, asset))
        .reduce((total, fee) => total + fee.amount, 0n);
    const batches = tempoChain ? [calls] : calls.map((call) => [call]);
    for (const [index, batch] of batches.entries()) {
        const prepared = (await prepareTransactionRequest(client, (tempoChain
            ? {
                account: client.account,
                calls: batch.map(({ to, data, value }) => ({ to, data, value })),
                feeToken: asset,
                nonceKey: 'expiring',
                validBefore: limits.expiresAt,
            }
            : { account: client.account, ...withoutGas(batch[0]) })));
        // Gas limit times fee cap is the most a signed transaction can charge; Viem always fills the
        // limit, and a legacy transaction without a fee cap costs zero here and is refused.
        const cost = feeAmount(client, prepared.gas * (prepared.maxFeePerGas ?? 0n));
        check(cost > 0n && cost <= budget, 'Relay Protocol gas exceeds the quoted fee');
        budget -= cost;
        request.signal.throwIfAborted();
        // Once an approval is out, its deposit must follow, so only the first signature checks expiry.
        check(index > 0 || limits.expiresAt > nowSeconds(), 'Relay Protocol quote expired before signing');
        const hash = await sendTransaction(client, prepared);
        const receipt = await waitForTransactionReceipt(client, {
            hash,
            timeout: untilDeadline(request.deadline),
        });
        check(receipt.status === 'success', 'Relay Protocol source transaction reverted');
    }
    // Quote parsing guarantees one request ID across the steps that carry one.
    return { reference: quote.steps.find((step) => step.requestId)?.requestId };
}
/**
 * Default `status`: reads Relay's intent status. Success also needs every reported destination
 * transaction to have a successful receipt when a destination client is configured.
 */
export async function viemStatus(viem, operation, { signal }) {
    const reference = operation.reference ?? operation.quote.reference;
    const { fetch } = viem;
    let response;
    try {
        response = await fetch(`${viem.url}/intents/status/v3?requestId=${encodeURIComponent(reference)}`, { signal });
    }
    catch {
        // A network failure is polled again until the deadline; cancellation is not.
        signal.throwIfAborted();
        return { status: 'pending' };
    }
    if (response.status === 429 || response.status >= 500)
        return { status: 'pending' };
    if (!response.ok)
        throw new FundingError(`Relay Protocol status request failed with HTTP ${response.status}`);
    let body;
    try {
        body = await response.json();
    }
    catch {
        // The connection can fail while the body streams; poll again unless cancelled.
        signal.throwIfAborted();
        return { status: 'pending' };
    }
    const status = isRecord(body) ? body.status : undefined;
    if (status === 'refund')
        return { status: 'refunded' };
    if (status === 'failure')
        return { status: 'actionRequired' };
    if (pendingStatuses.includes(status))
        return { status: 'pending' };
    check(status === 'success', 'Relay Protocol reported an unknown status');
    // A success status means the body is an object.
    const hashes = body.txHashes;
    check(Array.isArray(hashes) &&
        hashes.length > 0 &&
        hashes.length <= maxDestinationHashes &&
        hashes.every((hash) => typeof hash === 'string' && hash32.test(hash)), 'Relay Protocol success has no destination transaction');
    const destination = operation.request.to;
    const client = viem.clients[destination.chainId];
    if (!client)
        return { status: 'completed' };
    let delivered = 0n;
    for (const hash of hashes) {
        signal.throwIfAborted();
        let receipt;
        try {
            receipt = await getTransactionReceipt(client, { hash });
        }
        catch {
            // The destination RPC may lag Relay or fail transiently; poll again until the deadline.
            return { status: 'pending' };
        }
        if (receipt.status !== 'success')
            return { status: 'actionRequired' };
        // Stryker disable next-line EqualityOperator: on equal blocks either comparison keeps the same value
        if (receipt.blockNumber > delivered)
            delivered = receipt.blockNumber;
    }
    // Balance reads for this account wait for this block, so a lagging RPC node cannot hide delivery.
    const key = accountKey(destination);
    // Stryker disable next-line EqualityOperator: on equal blocks either comparison stores the same value
    if (delivered > (viem.settled.get(key) ?? 0n))
        viem.settled.set(key, delivered);
    return { status: 'completed' };
}
/**
 * Reads an account's token balance on its chain, or its native balance for the zero address. After
 * a delivery to the account, the read waits until the RPC reaches the delivery block and reads at
 * that height or later.
 */
export async function viemBalance(viem, account) {
    const client = clientFor(viem.clients, account.chainId);
    const read = (blockNumber) => same(account.asset, zeroAddress)
        ? getBalance(client, { address: account.owner, blockNumber })
        : readContract(client, {
            address: account.asset,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account.owner],
            blockNumber,
        });
    const delivered = viem.settled.get(accountKey(account));
    if (delivered === undefined)
        return read(undefined);
    let failure;
    for (let attempt = 1;; attempt++) {
        try {
            const head = await getBlockNumber(client, { cacheTime: 0 });
            if (head >= delivered)
                return await read(head);
        }
        catch (cause) {
            // A load-balanced backend behind the head may not serve that block yet.
            failure = cause;
        }
        if (attempt === settledReadAttempts)
            throw new FundingError('Destination RPC has not reached the delivery block', {
                cause: failure,
            });
        await sleep(settledReadPauseMs);
    }
}
function accountKey(account) {
    return `${account.chainId}:${account.asset.toLowerCase()}:${account.owner.toLowerCase()}`;
}
function clientFor(clients, chainId) {
    const client = clients[chainId];
    if (!client)
        throw new InvalidConfigurationError(`No Viem client configured for chain ${chainId}`);
    return client;
}
/** The source client, which must sign as the funding account. */
function signer(viem, request) {
    const client = clientFor(viem.clients, request.from.chainId);
    if (!same(client.account?.address, request.from.owner))
        throw new InvalidConfigurationError('Relay Protocol source client must sign as the funding account');
    return client;
}
function isTempo(client) {
    // Clients are validated to have a chain.
    return client.chain.serializers?.transaction === tempoSerializer;
}
/** Tempo charges the chain's fee token, or else the source token; other chains charge native gas. */
function feeAsset(client, request) {
    if (!isTempo(client))
        return zeroAddress;
    const token = client.chain.feeToken;
    return typeof token === 'string' ? token : request.from.asset;
}
/** Converts gas times fee per gas to atomic units of the fee asset, rounding up. */
function feeAmount(client, cost) {
    return isTempo(client) ? (cost + tempoFeeScale - 1n) / tempoFeeScale : cost;
}
function gasHint(value) {
    return /^[1-9]\d*$/.test(String(value)) ? BigInt(value) : undefined;
}
function withoutGas({ gas: _gas, ...call }) {
    return call;
}
function same(value, expected) {
    return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}
function check(condition, message) {
    if (!condition)
        throw new FundingError(message);
}
