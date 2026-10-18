import { FundingError } from '../core/errors.js';
import { immutableSnapshot } from '../core/immutable.js';
import { isRecord } from '../core/validate.js';
const stepShape = {
    id: 'string',
    kind: 'string',
    requestId: 'string',
    depositAddress: 'string',
    items: [
        {
            status: 'string',
            check: { endpoint: 'string', method: 'string' },
            data: { chainId: 'number', data: 'string', from: 'string', to: 'string', value: 'string' },
        },
    ],
};
/** Creates a resumable Relay route with application-supplied signing and status lookup. */
export function relayProtocol(options) {
    if (typeof options.guarantees !== 'function' ||
        typeof options.submit !== 'function' ||
        typeof options.status !== 'function')
        throw new FundingError('Relay Protocol guarantees, submit, and status callbacks are required', {
            code: 'INVALID_CONFIGURATION',
        });
    const guarantees = options.guarantees.bind(options);
    const submit = options.submit.bind(options);
    const quoteOptions = Object.freeze({ ...options });
    return Object.freeze({
        name: options.name ?? 'relay-protocol',
        executionMode: 'bounded',
        async quote(request) {
            const { quote, amountIn, reference } = await fetchRelayQuote(quoteOptions, request);
            const limits = limitsOf(await guarantees({ quote, request }));
            // The funder validates these bounds against the quote and policy before claiming.
            return immutableSnapshot({
                amountIn,
                data: quote,
                reference,
                amountOut: request.amountOut,
                minAmountOut: request.amountOut,
                ...limits,
            });
        },
        async submit({ quote, request }) {
            request.signal.throwIfAborted();
            const limits = limitsOf(quote);
            const parsed = parseQuote(immutableSnapshot(quote.data), request);
            if (parsed.amountIn > limits.maxAmountIn)
                throw new FundingError('Relay Protocol quote exceeds its maximum input');
            return submit({ quote: parsed.quote, limits, request });
        },
        status: options.status.bind(options),
    });
}
async function fetchRelayQuote(options, request) {
    const fetchQuote = options.fetch ?? globalThis.fetch;
    const url = (options.url ?? 'https://api.relay.link').replace(/\/$/, '');
    const response = await fetchQuote(`${url}/quote/v2`, {
        body: JSON.stringify({
            amount: request.amountOut.toString(),
            destinationChainId: request.to.chainId,
            destinationCurrency: request.to.asset,
            enableTrueExactOutput: true,
            includeProtocolData: true,
            ...(options.useDepositAddress ? { useDepositAddress: true, strict: true } : {}),
            originChainId: request.from.chainId,
            originCurrency: request.from.asset,
            recipient: request.to.account,
            refundTo: request.from.account,
            slippageTolerance: request.maxSlippageBps.toString(),
            tradeType: 'EXACT_OUTPUT',
            user: request.from.account,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: request.signal,
    });
    if (!response.ok)
        throw new FundingError(`Relay Protocol quote request failed with HTTP ${response.status}`);
    let body;
    try {
        body = await response.json();
    }
    catch (cause) {
        throw new FundingError('Relay Protocol quote response is not JSON', { cause });
    }
    return parseQuote(immutableSnapshot(body), request);
}
/**
 * Strictly parses an untrusted provider quote against the request it must fulfil. Every typed field
 * is checked before use, so malformed data fails with FundingError rather than a TypeError.
 */
function parseQuote(value, request) {
    if (!isRecord(value))
        throw new FundingError('Relay Protocol quote must be an object');
    const details = isRecord(value.details) ? value.details : {};
    const { currencyIn: input, currencyOut: output, sender, recipient } = details;
    if (!isRecord(input) ||
        !isRecord(output) ||
        !isRecord(input.currency) ||
        !isRecord(output.currency))
        throw new FundingError('Relay Protocol quote is missing currency details');
    if (input.currency.chainId !== request.from.chainId ||
        !sameAddress(input.currency.address, request.from.asset))
        throw new FundingError('Relay Protocol quote changed the source asset');
    if (output.currency.chainId !== request.to.chainId ||
        !sameAddress(output.currency.address, request.to.asset))
        throw new FundingError('Relay Protocol quote changed the destination asset');
    if (!sameAddress(sender, request.from.account))
        throw new FundingError('Relay Protocol quote changed the source account');
    if (!sameAddress(recipient, request.to.account))
        throw new FundingError('Relay Protocol quote changed the destination account');
    if (output.amount !== request.amountOut.toString())
        throw new FundingError('Relay Protocol quote changed the exact output amount');
    if (typeof input.amount !== 'string' || !/^[1-9]\d*$/.test(input.amount))
        throw new FundingError('Relay Protocol quote has an invalid input amount');
    if (!conforms(value, { steps: [stepShape] }))
        throw new FundingError('Relay Protocol quote has malformed steps');
    const steps = value.steps;
    const reference = steps?.find((step) => step.requestId)?.requestId;
    if (!reference)
        throw new FundingError('Relay Protocol quote has no request ID');
    return Object.freeze({
        quote: value,
        amountIn: BigInt(input.amount),
        reference,
    });
}
/** Spending bounds with the types execution relies on; fee details are validated by the funder. */
function limitsOf(value) {
    if (!isRecord(value) ||
        typeof value.maxAmountIn !== 'bigint' ||
        !Array.isArray(value.fees) ||
        !Number.isSafeInteger(value.expiresAt))
        throw new FundingError('Relay Protocol spending limits are invalid');
    return Object.freeze({
        maxAmountIn: value.maxAmountIn,
        fees: value.fees,
        expiresAt: value.expiresAt,
    });
}
/** Whether every present field of `value` has the type its shape declares. */
function conforms(value, shape) {
    return (isRecord(value) &&
        Object.entries(shape).every(([field, expected]) => {
            const actual = value[field];
            if (actual === undefined)
                return true;
            if (typeof expected === 'string')
                return typeof actual === expected;
            if (isList(expected))
                return Array.isArray(actual) && actual.every((item) => conforms(item, expected[0]));
            return conforms(actual, expected);
        }));
}
function isList(shape) {
    return Array.isArray(shape);
}
function sameAddress(value, expected) {
    return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}
//# sourceMappingURL=relay-protocol.js.map