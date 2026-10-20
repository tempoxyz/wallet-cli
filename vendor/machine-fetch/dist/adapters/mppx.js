import { Mppx } from 'mppx/client';
import { Types as X402 } from 'mppx/x402';
import { InvalidConfigurationError } from '../core/errors.js';
import { immutableSnapshot } from '../core/immutable.js';
import { machineFetch } from '../core/machine-fetch.js';
import { createBeforePayment } from '../core/prepare.js';
import { neverAborted } from '../core/time.js';
import { assertOperationId, assertPayer, isPayer, isRecord } from '../core/validate.js';
import { autoSwapDisabled, tempoFunder } from '../funders/tempo.js';
import { invalidPayment, parseAtomicAmount, parseNetwork, x402PaymentRequirement, } from './shared.js';
/** Creates a paid Fetch function from Mppx methods plus machine-fetch funders and policy. */
export function mppxFetch(options) {
    const { deadlineSeconds, funders, maxFundingSpend, maxPayment, maxSlippageBps, onFundingComplete, onPaymentFailed, onPaymentReady, onPaymentRequired, payer, sameCurrencyOnly, ...mppx } = options;
    return machineFetch({
        client: createMppxPayment(mppx),
        deadlineSeconds,
        funders,
        maxFundingSpend,
        maxPayment,
        maxSlippageBps,
        onFundingComplete,
        onPaymentFailed,
        onPaymentReady,
        onPaymentRequired,
        payer,
        sameCurrencyOnly,
    });
}
/**
 * Adapts an existing Mppx client, reusing its methods, transport, and raw fetch. Mppx does not
 * expose its other create-time settings, so supply `attestation`, `acceptPaymentPolicy`,
 * `maxPaymentRetries`, `orderChallenges`, and `paymentPreferences` again in `options`; omitted
 * settings take Mppx's defaults for an unpolyfilled client, so `acceptPaymentPolicy` defaults to
 * `'always'`. The client's `onChallenge` and event handlers are not used.
 */
export function fromMppx(client, options = {}) {
    return createMppxPayment({
        methods: client.methods,
        transport: client.transport,
        fetch: client.rawFetch,
        ...options,
    });
}
/**
 * Creates an Mppx CLI extension backed by machine-fetch policy and funders. Each payment uses the
 * host's operation ID, or a random one, and the host's signal, when it supplies one.
 */
export function mppxExtension(options = {}) {
    const { autoSwap, compose, payer: configuredPayer, ...machineFetchOptions } = options;
    if (configuredPayer !== undefined)
        assertPayer(configuredPayer);
    const beforePayment = createBeforePayment({
        ...machineFetchOptions,
        funders: [...(machineFetchOptions.funders ?? []), tempoFunder(autoSwap)],
    });
    const combine = (current, prepared) => {
        if (current === undefined)
            return prepared;
        if (prepared === undefined)
            return current;
        if (compose)
            return compose(current, prepared);
        if (isRecord(current) && isRecord(prepared))
            return Object.freeze({ ...current, ...prepared });
        throw new InvalidConfigurationError('Cannot combine non-object Mppx credential contexts. Provide compose.', {});
    };
    return Object.freeze({
        async preparePayment({ operationId = crypto.randomUUID(), challenge, credentialContext, payer: requestPayer, signal, }) {
            assertOperationId(operationId);
            if (requestPayer !== undefined)
                assertPayer(requestPayer);
            if (configuredPayer !== undefined && !isPayer(requestPayer, configuredPayer))
                throw new InvalidConfigurationError('Payment payer differs from the configured payer');
            const payer = requestPayer ?? configuredPayer;
            const prepared = await beforePayment(mppxRequirement(challenge), Object.freeze({
                operationId,
                signal: signal ?? neverAborted,
                // Stryker disable next-line ConditionalExpression: funding drops an explicit undefined payer exactly like an omitted one
                ...(payer === undefined ? {} : { payer }),
            }));
            const funding = prepared?.funding ? { funding: immutableSnapshot(prepared.funding) } : {};
            const source = prepared && Object.hasOwn(prepared, 'context') ? prepared : unprepared(challenge);
            if (!source)
                return prepared?.funding ? Object.freeze(funding) : undefined;
            return Object.freeze({
                credentialContext: combine(credentialContext, source.context),
                ...funding,
            });
        },
    });
}
function createMppxPayment({ autoSwap, ...config }) {
    return Object.freeze({
        funders: Object.freeze([tempoFunder(autoSwap)]),
        bind({ beforePayment }) {
            const raw = Mppx.create({ ...config, polyfill: false }).rawFetch;
            return Object.freeze({
                // Mppx event listeners are observational and swallow listener errors. A request-local
                // wrapper with onChallenge keeps policy rejection fail-closed before credential creation
                // and hands the hook this request's payment context.
                async fetch(input, init, context) {
                    context.signal.throwIfAborted();
                    return Mppx.create({
                        ...config,
                        fetch: raw,
                        polyfill: false,
                        async onChallenge(challenge, { createCredential }) {
                            const prepared = await beforePayment(mppxRequirement(challenge), context);
                            // Observers and other callbacks may cancel after the hook settles; never sign then.
                            context.signal.throwIfAborted();
                            return createCredential((prepared?.context ?? unprepared(challenge)?.context));
                        },
                    }).fetch(input, init);
                },
                raw,
            });
        },
    });
}
/**
 * Context for a payment no funder prepared. Mppx's Tempo auto-swap then stays off, so it never runs
 * with the method's own settings outside machine-fetch policy, such as for an unknown token.
 */
function unprepared(challenge) {
    return challenge.method === 'tempo' ? autoSwapDisabled : undefined;
}
/** Converts an MPP or Mppx-translated x402 challenge to the common model. */
export function mppxRequirement(challenge) {
    if (challenge.id.startsWith(X402.syntheticChallengeIdPrefix))
        return normalizeX402Challenge(challenge);
    // Native MPP request fields are method-defined. Normalize the shared conventions after Mppx has
    // selected the method; x402 is handled above by its concrete public schema.
    const request = challenge.request;
    const methodDetails = recordField(request, 'methodDetails');
    const asset = stringField(request, 'currency') ?? stringField(request, 'asset');
    if (!asset)
        throw invalidPayment('Mppx payment challenge has no asset');
    const recipient = stringField(request, 'recipient') ?? stringField(request, 'payTo');
    const decimals = numberField(request, 'decimals') ?? numberField(methodDetails ?? {}, 'decimals');
    const currency = stringField(request, 'currencyCode') ??
        (challenge.method === 'stripe' ? stringField(request, 'currency')?.toUpperCase() : undefined);
    return immutableSnapshot({
        protocol: 'mpp',
        method: challenge.method,
        intent: challenge.intent,
        network: nativeNetwork(challenge.method, request, methodDetails),
        asset,
        amount: parseAtomicAmount(request.amount ?? request.maxAmountRequired),
        ...(recipient ? { recipient } : {}),
        resource: challenge.realm,
        ...(decimals !== undefined ? { decimals } : {}),
        ...(currency ? { currency } : {}),
        metadata: { challengeMeta: challenge.meta, request },
    });
}
function normalizeX402Challenge(challenge) {
    const parsed = X402.PaymentRequirementsSchema.safeParse(challenge.request);
    if (!parsed.success)
        throw invalidPayment('Invalid Mppx x402 payment challenge', parsed.error);
    const resource = stringField(recordField(challenge.request, 'resource') ?? {}, 'url');
    // Mppx translates only x402 v2 challenges.
    return immutableSnapshot(x402PaymentRequirement(parsed.data, resource ?? challenge.realm, 2));
}
/**
 * The network a native method signs on. A method may name it several ways, and they must agree:
 * policy and funders would otherwise see a different network than the one that is paid.
 */
function nativeNetwork(method, request, methodDetails) {
    const named = [
        stringField(request, 'network'),
        chainNetwork(request.chainId),
        chainNetwork(methodDetails?.chainId),
    ].filter((network) => network !== undefined);
    const [network = networkFromId(method, methodDetails?.networkId) ?? `mpp:${method}`] = named;
    if (named.some((other) => other !== network))
        throw invalidPayment('Mppx payment challenge names conflicting networks');
    return parseNetwork(network);
}
function chainNetwork(chainId) {
    if (chainId === undefined)
        return undefined;
    if (!Number.isSafeInteger(chainId) || chainId <= 0)
        throw invalidPayment('Payment chain ID must be a positive safe integer');
    return `eip155:${chainId}`;
}
function networkFromId(method, value) {
    return typeof value === 'string' && value.length > 0 ? `${method}:${value}` : undefined;
}
function stringField(value, key) {
    return typeof value[key] === 'string' ? value[key] : undefined;
}
function numberField(value, key) {
    return typeof value[key] === 'number' ? value[key] : undefined;
}
function recordField(value, key) {
    const field = value[key];
    return isRecord(field) ? field : undefined;
}
