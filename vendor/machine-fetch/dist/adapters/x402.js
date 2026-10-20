import { wrapFetchWithPayment } from '@x402/fetch';
import { DisposedError, InvalidConfigurationError } from '../core/errors.js';
import { machineFetch } from '../core/machine-fetch.js';
import { invalidPayment, x402PaymentRequirement } from './shared.js';
const states = new WeakMap();
/** Wraps an existing official x402 client as a paid Fetch function. */
export function x402Fetch(client, options = {}) {
    const { fetch, ...core } = options;
    return machineFetch({ ...core, client: fromX402(client, { fetch }) });
}
/**
 * Adapts an existing official x402 client and preserves all registered schemes and policies.
 * While bound, the client creates payments only through the bound fetch; other credential creation
 * on it is rejected. After `dispose`, the binding's fetch rejects and the client may be rebound.
 */
export function fromX402(client, options = {}) {
    const raw = options.fetch ?? globalThis.fetch;
    const state = getState(client);
    return {
        bind({ beforePayment }) {
            if (state.binding)
                throw new InvalidConfigurationError('This x402 client is already bound to machine-fetch');
            const binding = Object.freeze({ beforePayment });
            state.binding = binding;
            return {
                fetch: async (input, init, context) => {
                    if (state.binding !== binding)
                        throw disposed();
                    context.signal.throwIfAborted();
                    // The upstream hook has no request context. Serialize only credential creation so
                    // concurrent HTTP requests cannot lend one another a payment context.
                    let failure;
                    const scoped = new Proxy(client, {
                        get(target, key) {
                            if (key === 'createPaymentPayload')
                                return (paymentRequired) => {
                                    const run = state.pending.then(async () => {
                                        if (state.binding !== binding)
                                            throw disposed();
                                        context.signal.throwIfAborted();
                                        state.creation = { binding, context, paymentRequired };
                                        try {
                                            const payload = await target.createPaymentPayload(paymentRequired);
                                            if (state.binding !== binding)
                                                throw disposed();
                                            context.signal.throwIfAborted();
                                            return payload;
                                        }
                                        finally {
                                            state.creation = undefined;
                                        }
                                    });
                                    state.pending = run.then(() => undefined, () => undefined);
                                    return run.catch((error) => {
                                        failure = { error };
                                        throw error;
                                    });
                                };
                            const value = Reflect.get(target, key);
                            // Stryker disable next-line ConditionalExpression: upstream reads only methods through this proxy
                            return typeof value === 'function' ? value.bind(target) : value;
                        },
                    });
                    // Upstream replaces credential failures with generic errors. Restore the original
                    // captured by this request without mixing failures between concurrent requests.
                    return wrapFetchWithPayment(raw, scoped)(input, init).catch((error) => {
                        if (failure)
                            throw failure.error;
                        throw error;
                    });
                },
                raw,
                dispose: () => {
                    if (state.binding === binding)
                        state.binding = undefined;
                },
            };
        },
    };
}
/** Converts an official x402 selection to the common payment model. */
export function x402Requirement(context) {
    // Version 1 challenges carry no resource object; the declared type only describes version 2.
    const { resource, x402Version } = context.paymentRequired;
    if (x402Version !== 2 || typeof resource?.url !== 'string')
        throw invalidPayment('Only x402 version 2 payment challenges are supported');
    return x402PaymentRequirement(context.selectedRequirements, resource.url, x402Version);
}
function getState(client) {
    const existing = states.get(client);
    if (existing)
        return existing;
    const state = { binding: undefined, creation: undefined, pending: Promise.resolve() };
    states.set(client, state);
    // Upstream hooks cannot be removed, so one hook per client serves every binding and fails closed
    // for any credential creation that the current binding did not start.
    client.onBeforePaymentCreation(async (upstream) => {
        try {
            const creation = state.creation;
            if (creation?.paymentRequired !== upstream.paymentRequired) {
                if (state.binding || creation)
                    throw new InvalidConfigurationError('A bound x402 client creates payments only through its fetch', {});
                return;
            }
            if (creation.binding !== state.binding)
                throw disposed();
            const prepared = await creation.binding.beforePayment(x402Requirement(upstream), creation.context);
            // Observers and other callbacks may cancel after the hook settles; never sign then.
            creation.context.signal.throwIfAborted();
            if (creation.binding !== state.binding)
                throw disposed();
            if (prepared?.context !== undefined)
                throw new InvalidConfigurationError('x402 funders cannot provide credential context');
        }
        catch (cause) {
            // This hook runs outside upstream credential recovery, so rejection cannot be bypassed.
            throw cause instanceof Error ? cause : new Error('Payment preparation failed');
        }
    });
    return state;
}
function disposed() {
    return new DisposedError('x402 payment client binding was disposed');
}
