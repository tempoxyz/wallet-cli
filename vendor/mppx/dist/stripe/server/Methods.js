import * as EvmAssets from '../../evm/Assets.js';
import { charge as evmCharge } from '../../evm/server/Charge.js';
import * as tempoDefaults from '../../tempo/internal/defaults.js';
import { charge as tempoCharge } from '../../tempo/server/Charge.js';
import { session as tempoSession } from '../../tempo/session/server/Session.js';
import * as z from '../../zod.js';
import * as PaymentIntent from '../internal/payment-intent.js';
import { charge as charge_ } from './Charge.js';
import { buildAnalytics } from './internal/analytics.js';
import { findOrCreateDepositAddress as _findOrCreateDepositAddress } from './internal/deposit-address.js';
import * as HostedFeePayer from './internal/hosted-fee-payer.js';
import { recordCryptoPayment } from './internal/record-payment.js';
const defaultMethodNames = ['tempo', 'spt'];
const additionalBuiltinKeys = ['base', 'tempo'];
class DefaultMethodsBuilder {
    #resolve;
    #additional;
    constructor(resolve) {
        this.#resolve = resolve;
    }
    additional(config) {
        this.#additional = config;
        return this;
    }
    then(onfulfilled, onrejected) {
        return this.#resolve(this.#additional).then(onfulfilled, onrejected);
    }
}
/**
 * Creates a configured Stripe machine payments instance.
 *
 * @example
 * ```ts
 * import { Mppx, stripe } from 'mppx/server'
 *
 * const machinePayments = stripe.create({
 *   client: stripeClient,
 *   networkId: process.env.STRIPE_PROFILE_ID!,
 *   livemode: !process.env.STRIPE_SECRET_KEY!.includes('_test_'),
 * })
 *
 * // Async: deposit addresses resolved from Stripe API
 * const mppx = Mppx.create({
 *   methods: await machinePayments.defaultMethods(),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Sync: deposit addresses provided statically
 * const machinePayments = stripe.create({
 *   client: stripeClient,
 *   networkId: process.env.STRIPE_PROFILE_ID!,
 *   livemode: !process.env.STRIPE_SECRET_KEY!.includes('_test_'),
 *   depositAddresses: { tempo: process.env.TEMPO_DEPOSIT_ADDRESS! },
 * })
 *
 * const mppx = Mppx.create({
 *   methods: machinePayments.defaultMethods(),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * @example
 * ```ts
 * // With additional custom rails
 * const mppx = Mppx.create({
 *   methods: await machinePayments.defaultMethods().additional({
 *     base: { x402: { facilitator } },
 *     solana: (address) => solana.charge({ recipient: address, currency: USDC, decimals: 6 }),
 *   }),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * PaymentIntent option resolvers run after non-mutating method validation, when
 * available, and before the terminal payment operation. If Stripe later rejects
 * resolved optional fields while recording a completed crypto payment, mppx
 * retries the recording once without them. SPT payments do not use this fallback.
 */
export function stripe(parameters) {
    const { client, networkId, livemode, hostedFeePayer, connect, depositAddresses, metadata } = parameters;
    if (!client.rawRequest)
        throw new Error('stripe.create() requires a Stripe SDK client with rawRequest() (v15+)');
    if (hostedFeePayer && connect)
        throw new Error('Stripe hosted fee payer does not support Connect account routing.');
    const tempoCurrency = (livemode ? tempoDefaults.tokens.usdc : tempoDefaults.tokens.pathUsd);
    const hostedTempoFeePayer = hostedFeePayer && livemode ? HostedFeePayer.create(client) : undefined;
    const tempoPaymentHandler = createPaymentSuccessHandler(client, 'tempo', connect, metadata);
    const basePaymentHandler = createPaymentSuccessHandler(client, 'base', connect, metadata);
    // All stripe-managed crypto rails use 6-decimal stablecoins. Reject amounts
    // below 1 cent since Stripe cannot record them.
    const cryptoCanOffer = ({ request }) => Number(request.amount) >= 10_000;
    function makeSptCharge(params) {
        return charge_({
            client,
            networkId,
            currency: 'usd',
            decimals: 2,
            paymentMethodTypes: params?.paymentMethodTypes ?? ['card', 'link'],
            ...(connect && { connect }),
            ...(metadata && { metadata }),
        });
    }
    function makeTempoCharge(params) {
        const { recipient, metadata: callMetadata, ...rest } = params;
        const handler = callMetadata
            ? createPaymentSuccessHandler(client, 'tempo', connect, { ...metadata, ...callMetadata })
            : tempoPaymentHandler;
        return withPaymentIntentInput(tempoCharge({
            currency: tempoCurrency,
            recipient,
            ...(!livemode && { testnet: true }),
            ...(hostedTempoFeePayer && { feePayer: hostedTempoFeePayer }),
            canOffer: cryptoCanOffer,
            onPaymentSuccess: handler,
            ...rest,
        }));
    }
    function makeTempoSession(params) {
        const { recipient, onSessionSettlement, ...rest } = params;
        return tempoSession({
            currency: tempoCurrency,
            recipient,
            ...(!livemode && { chainId: tempoDefaults.chainId.testnet }),
            ...(hostedTempoFeePayer && { feePayer: hostedTempoFeePayer }),
            ...rest,
            async onSessionSettlement(context) {
                await tempoPaymentHandler({
                    intent: 'session',
                    receipt: { reference: context.txHash },
                    request: { amount: context.delta.toString() },
                });
                await onSessionSettlement?.(context);
            },
        });
    }
    function makeBaseCharge(params) {
        const { recipient, x402, metadata: callMetadata, ...rest } = params;
        const handler = callMetadata
            ? createPaymentSuccessHandler(client, 'base', connect, { ...metadata, ...callMetadata })
            : basePaymentHandler;
        return withPaymentIntentInput(evmCharge({
            currency: livemode ? EvmAssets.base.USDC : EvmAssets.baseSepolia.USDC,
            recipient,
            x402,
            canOffer: cryptoCanOffer,
            onPaymentSuccess: handler,
            ...rest,
        }));
    }
    const defaultMethodBuilders = {
        tempo: (addresses) => {
            const address = addresses.get('tempo');
            if (!address)
                return null;
            return makeTempoCharge({ recipient: address });
        },
        spt: () => makeSptCharge(),
    };
    const additionalBuilders = {
        base: (addresses, config) => {
            if (!config.base)
                return null;
            const address = addresses.get('base');
            if (!address)
                return null;
            return makeBaseCharge({ recipient: address, ...config.base });
        },
        tempo: (addresses, config) => {
            if (!config.tempo?.session)
                return null;
            const address = addresses.get('tempo');
            if (!address)
                return null;
            return makeTempoSession({ recipient: address, ...config.tempo.session });
        },
    };
    function createMethodsFromAddresses(addresses, excluded, additional) {
        const result = [];
        for (const name of defaultMethodNames) {
            if (excluded.has(name))
                continue;
            const method = defaultMethodBuilders[name](addresses);
            if (method)
                result.push(method);
        }
        if (additional) {
            for (const key of Object.keys(additionalBuilders)) {
                const method = additionalBuilders[key](addresses, additional);
                if (method)
                    result.push(method);
            }
            for (const [network, factory] of customRails(additional)) {
                const address = requireAddress(addresses, network);
                const recorder = createPaymentSuccessHandler(client, network, connect, metadata);
                for (const m of toArray(factory(address))) {
                    const onPaymentSuccess = m.onPaymentSuccess
                        ? (params) => Promise.all([m.onPaymentSuccess(params), recorder(params)]).then(() => { })
                        : recorder;
                    const canOffer = m.canOffer
                        ? (params) => cryptoCanOffer(params) && m.canOffer(params)
                        : cryptoCanOffer;
                    result.push(withPaymentIntentInput({ ...m, canOffer, onPaymentSuccess }));
                }
            }
        }
        return result;
    }
    function resolveAddress(network) {
        if (typeof depositAddresses === 'function')
            return depositAddresses(network);
        return _findOrCreateDepositAddress(client, network, connect ? { connect } : undefined);
    }
    function defaultMethods(config) {
        const excluded = new Set(config?.exclude);
        if (typeof depositAddresses === 'function') {
            // Async: resolve addresses dynamically
            return new DefaultMethodsBuilder(async (additional) => {
                const networks = neededNetworks(excluded, additional);
                const results = await Promise.allSettled(networks.map(async (network) => ({
                    network,
                    address: await resolveAddress(network),
                })));
                const addresses = new Map();
                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        addresses.set(result.value.network, result.value.address);
                    }
                    else {
                        const idx = results.indexOf(result);
                        console.warn(`[stripe.create] ${networks[idx]} method excluded: ${result.reason?.message ?? result.reason}`);
                    }
                }
                return createMethodsFromAddresses(addresses, excluded, additional);
            });
        }
        const addresses = new Map(Object.entries(depositAddresses ?? {}));
        return Object.assign(createMethodsFromAddresses(addresses, excluded), {
            additional: (additional) => createMethodsFromAddresses(addresses, excluded, additional),
        });
    }
    return {
        spt: { charge: makeSptCharge },
        tempo: { charge: makeTempoCharge, session: makeTempoSession },
        base: { charge: makeBaseCharge },
        findOrCreateDepositAddress: async (network) => {
            const address = await resolveAddress(network);
            return address;
        },
        defaultMethods,
    };
}
(function (stripe) {
    stripe.spt = charge_;
    /** @deprecated Use `stripe.create({ ... }).spt.charge()` or `stripe.spt()` instead. */
    stripe.charge = charge_;
    stripe.create = stripe;
    stripe.findOrCreateDepositAddress = _findOrCreateDepositAddress;
})(stripe || (stripe = {}));
function neededNetworks(excluded, additional) {
    const networks = [];
    if (!excluded.has('tempo') || additional?.tempo?.session)
        networks.push('tempo');
    if (additional?.base)
        networks.push('base');
    for (const [network] of customRails(additional)) {
        networks.push(network);
    }
    return networks;
}
function requireAddress(addresses, network) {
    const address = addresses.get(network);
    if (!address)
        throw new Error(`stripe: missing deposit address for ${network}`);
    return address;
}
function toArray(value) {
    return Array.isArray(value) ? value : [value];
}
function customRails(additional) {
    if (!additional)
        return [];
    return Object.entries(additional).filter((entry) => {
        const [k, v] = entry;
        return !additionalBuiltinKeys.includes(k) && typeof v === 'function';
    });
}
function createPaymentSuccessHandler(client, network, connect, metadata) {
    return (params) => {
        const { challenge, intent, receipt, request, requestInput } = params;
        if (receipt?.reference && request?.amount) {
            const paymentIntentOptionsInput = requestInput?.paymentIntentOptions;
            const paymentIntentOptions = typeof paymentIntentOptionsInput === 'function' ? undefined : paymentIntentOptionsInput;
            const resolvedMetadata = {
                ...metadata,
                ...paymentIntentOptions?.metadata,
            };
            const resolvedPaymentIntentOptions = {
                ...paymentIntentOptions,
                ...(Object.keys(resolvedMetadata).length > 0 && { metadata: resolvedMetadata }),
            };
            return recordCryptoPayment(client, {
                network,
                reference: receipt.reference,
                amount: String(request.amount),
                ...(connect && { connect }),
                analyticsMetadata: buildAnalytics({ challenge, intent }),
                ...(Object.keys(resolvedPaymentIntentOptions).length > 0 && {
                    paymentIntentOptions: resolvedPaymentIntentOptions,
                }),
            });
        }
    };
}
/**
 * Extends a rail's server-only input with Stripe PaymentIntent options while
 * keeping its canonical request unchanged. The schema strips the options
 * before challenge serialization, and delegated lifecycle hooks receive the
 * underlying rail request without Stripe-only fields. After method validation,
 * the wrapper resolves the options immediately before the terminal operation
 * and retains the result in `requestInput` for payment-success recording.
 */
function withPaymentIntentInput(method) {
    const baseSchema = method.schema.request;
    const baseRequest = method.request;
    const baseRespond = method.respond;
    const baseBroadcast = method.broadcast;
    const baseValidate = method.validate;
    const baseVerify = method.verify;
    return {
        ...method,
        // Accept Stripe-only options without changing the canonical rail schema.
        schema: {
            ...method.schema,
            request: z.pipe(z.custom(), z.transform((input) => {
                const { paymentIntentOptions, ...request } = input;
                z.optional(PaymentIntent.InputSchema).parse(paymentIntentOptions);
                // Only the base schema's output is included in the challenge.
                return baseSchema.parse(request);
            })),
        },
        async request(context) {
            const { paymentIntentOptions, ...request } = context.request;
            const resolved = baseRequest ? await baseRequest({ ...context, request }) : request;
            // Keep the server-only value in requestInput for the success hook. The
            // schema transform above still excludes it from the signed challenge.
            return { ...resolved, paymentIntentOptions };
        },
        ...(baseRespond && {
            respond: (context) => baseRespond(withoutPaymentIntentOptions(context)),
        }),
        ...(baseBroadcast && {
            async broadcast(context) {
                await resolvePaymentIntentOptions(context);
                return baseBroadcast(withoutPaymentIntentOptions(context));
            },
        }),
        ...(baseValidate && {
            validate: (context) => baseValidate(withoutPaymentIntentOptions(context)),
        }),
        ...(baseVerify && {
            async verify(context) {
                await resolvePaymentIntentOptions(context);
                return baseVerify(withoutPaymentIntentOptions(context));
            },
        }),
    };
}
/** Resolves Stripe-only options immediately before the terminal payment operation. */
async function resolvePaymentIntentOptions(context) {
    const { paymentIntentOptions } = context.request;
    const resolved = await PaymentIntent.resolve(paymentIntentOptions, {
        challenge: context.credential.challenge,
        credential: context.credential,
        envelope: context.envelope,
        request: context.envelope?.request ?? context.credential.challenge.request,
    });
    // MPPX later snapshots this request-local input for onPaymentSuccess. Replacing
    // only the schema-stripped field keeps the canonical challenge unchanged.
    context.request.paymentIntentOptions = resolved;
}
function withoutPaymentIntentOptions(context) {
    const { paymentIntentOptions: _, ...request } = context.request;
    return { ...context, request };
}
//# sourceMappingURL=Methods.js.map