import * as Store from '../../Store.js';
import * as Currencies from '../internal/currencies.js';
import * as ChannelStore from '../session/server/ChannelStore.js';
import { charge as sessionCharge_, session as session_, settle as settle_, settleBatch as settleBatch_, } from '../session/server/Session.js';
import * as Ws_ from '../session/server/Ws.js';
import { charge as charge_ } from './Charge.js';
import { renew as renewSubscription_, subscription as subscription_ } from './Subscription.js';
const sessionServer = Object.assign(session_, {
    charge: sessionCharge_,
    settle: settle_,
    settleBatch: settleBatch_,
});
function createChargeMethod(parameters) {
    // `tempo()` accepts the intersection of charge/session parameters, then
    // forwards only the fields each method understands. Preserve the inferred
    // parameter type so configured request defaults remain visible to handlers.
    return charge_(parameters);
}
function createSessionMethod(parameters) {
    // These options apply only to charge, even when configured at the family level.
    const { allowedFeeTokens: _allowedFeeTokens, machineTokenEnabled: _machineTokenEnabled, ...sessionParameters } = parameters ?? {};
    return sessionServer(sessionParameters);
}
/**
 * Creates the common Tempo `charge` and `session` methods from shared parameters.
 *
 * Mainnet accepts OUSD first, then USDC.e. Testnet accepts OUSD first, then pathUSD.
 * Use `currencies`
 * for an ordered list of addresses/token definitions, including a one-element
 * list for a single asset. Each currency creates charge and session offers; list
 * order is presentation order, not a requirement on the client's choice.
 * Chain-indexed definitions (including `tokens.tempo` from `viem/tokens`) are
 * filtered to USD tokens deployed on `chainId`. Duplicates are removed by address.
 * Explicit lists replace the defaults; an empty resolved list throws.
 *
 * The chain defaults to Tempo mainnet (Moderato with `testnet: true`). Set
 * `chainId` explicitly when using a custom client for another network.
 *
 * When configured, `relay` applies to the `charge` method. Session vouchers
 * remain local state transitions and session relay delegation will be added
 * with its action-specific lifecycle support.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo.common({ recipient: '0x...' })],
 * })
 * ```
 */
export function tempo(parameters) {
    if (parameters?.currency !== undefined) {
        if (parameters.currencies !== undefined)
            throw new Error('Specify either `currency` or `currencies`, not both.');
        return [createChargeMethod(parameters), createSessionMethod(parameters)];
    }
    const { currencies: _currencies, ...shared } = parameters ?? {};
    const [first, ...rest] = Currencies.resolve(parameters ?? {});
    const sessions = sessionOffers(parameters);
    function createMethods(currency, index) {
        const configured = { ...shared, ...currency };
        return [createChargeMethod(configured), sessions[index]];
    }
    return [
        ...createMethods(first, 0),
        ...rest.flatMap((currency, index) => createMethods(currency, index + 1)),
    ];
}
(function (tempo) {
    /** Creates ordered Tempo charge offers: OUSD first, then the network fallback. */
    tempo.charge = chargeOffers;
    /** Creates the common Tempo `charge` and `session` methods from shared parameters. */
    tempo.common = tempo;
    /** Creates ordered TIP-1034 session offers with shared storage and settlement helpers. */
    tempo.session = Object.assign(sessionOffers, {
        charge: sessionCharge_,
        settle: settle_,
        settleBatch: settleBatch_,
    });
    /** Creates ordered subscription offers. Existing subscriptions retain their authorized currency. */
    tempo.subscription = subscriptionOffers;
    /** Renews an overdue Tempo subscription outside of the HTTP request path. */
    tempo.renewSubscription = renewSubscription_;
    /** One-shot settle: reads highest voucher from storage and submits on-chain. */
    tempo.settle = settle_;
    /** Batch-settle precompile-backed session channels. */
    tempo.settleBatch = settleBatch_;
    /** Experimental websocket helpers for Tempo sessions. */
    tempo.Ws = Ws_;
})(tempo || (tempo = {}));
/** Resolves the public factory configuration while preserving explicit legacy currencies. */
function resolveCurrencies(parameters) {
    if (parameters.currency !== undefined && parameters.currencies !== undefined)
        throw new Error('Specify either `currency` or `currencies`, not both.');
    return Currencies.resolve({
        ...parameters,
        ...(parameters.currency === undefined ? {} : { currencies: [parameters.currency] }),
    });
}
/** Creates OUSD-first charge offers, with explicit currency lists replacing the defaults. */
function chargeOffers(parameters) {
    const { currencies: _currencies, ...shared } = parameters ?? {};
    const [first, ...rest] = resolveCurrencies(parameters ?? {});
    function create(currency) {
        const configured = { ...shared, ...currency };
        return charge_(configured);
    }
    return [create(first), ...rest.map(create)];
}
/** Creates OUSD-first session offers with shared storage and currency-aware settlement helpers. */
function sessionOffers(parameters) {
    const { currencies: _currencies, ...shared } = parameters ?? {};
    const [first, ...rest] = resolveCurrencies(parameters ?? {});
    const store = parameters?.store ?? Store.memory();
    const settlements = new Map();
    const key = (chainId, currency) => `${chainId}:${currency.toLowerCase()}`;
    const settleScheduled = (channel) => {
        const settle = settlements.get(key(channel.chainId, channel.token));
        if (!settle)
            throw new Error('Channel currency is not configured for this session handler.');
        return settle(channel);
    };
    const extensions = {
        settleScheduled,
        serveWebSocket: (options) => Ws_.serve({
            ...options,
            store: ChannelStore.fromStore(store),
            onChargeCommitted: settleScheduled,
        }),
    };
    function create(currency) {
        const configured = { ...shared, ...currency, store };
        const method = session_(configured);
        settlements.set(key(currency.chainId, currency.currency), method.extensions.settleScheduled);
        return { ...method, extensions };
    }
    return [create(first), ...rest.map(create)];
}
/** Offers currencies for new subscriptions; stored subscriptions retain their authorized currency. */
function subscriptionOffers(parameters) {
    const { currencies: _currencies, ...shared } = parameters;
    const [first, ...rest] = resolveCurrencies(parameters);
    const store = parameters.store ?? Store.memory();
    function create(currency) {
        const configured = { ...shared, ...currency, store };
        return subscription_(configured);
    }
    return [create(first), ...rest.map(create)];
}
//# sourceMappingURL=Methods.js.map