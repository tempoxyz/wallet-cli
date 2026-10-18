import * as Challenge from '../../Challenge.js';
import * as AcceptPayment from '../../internal/AcceptPayment.js';
import type { MaybePromise } from '../../internal/types.js';
import type * as Method from '../../Method.js';
import type * as z from '../../zod.js';
import * as Transport from '../Transport.js';
export type ClientEventMap<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = {
    'challenge.received': ChallengeReceivedPayload<methods, response>;
    'credential.created': CredentialCreatedPayload<methods, response>;
    'payment.failed': PaymentFailedPayload<methods, response>;
    'payment.response': PaymentResponsePayload<methods, response>;
};
export type ClientEventName<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = keyof ClientEventMap<methods, response> | '*';
export type ClientEventEnvelope<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = {
    [name in keyof ClientEventMap<methods, response>]: Readonly<{
        name: name;
        payload: ClientEventMap<methods, response>[name];
    }>;
}[keyof ClientEventMap<methods, response>];
export type ClientEventPayload<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], name extends ClientEventName<methods> = ClientEventName<methods>, response = Response> = name extends '*' ? ClientEventEnvelope<methods, response> : name extends keyof ClientEventMap<methods, response> ? ClientEventMap<methods, response>[name] : never;
export type ClientEventResult<methods extends readonly Method.AnyClient[], name extends ClientEventName<methods> = ClientEventName<methods>, _response = Response> = name extends 'challenge.received' ? string | undefined : void;
export type ClientEventHandler<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], name extends ClientEventName<methods> = ClientEventName<methods>, response = Response> = (payload: ClientEventPayload<methods, name, response>) => MaybePromise<ClientEventResult<methods, name, response>>;
export type Unsubscribe = () => void;
export type ChallengeReceivedPayload<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = Readonly<{
    challenge: Challenge.Challenge;
    challenges: readonly Challenge.Challenge[];
    createCredential: (context?: AnyContextFor<methods>) => Promise<string>;
    init?: from.RequestInit<methods> | undefined;
    input?: RequestInfo | URL | undefined;
    method: methods[number];
    response: response;
}>;
export type CredentialCreatedPayload<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = Readonly<{
    challenge: Challenge.Challenge;
    credential: string;
    init?: from.RequestInit<methods> | undefined;
    input?: RequestInfo | URL | undefined;
    method: methods[number];
    response?: response | undefined;
}>;
export type PaymentResponsePayload<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = Readonly<{
    challenge: Challenge.Challenge;
    credential: string;
    init?: from.RequestInit<methods> | undefined;
    input?: RequestInfo | URL | undefined;
    method: methods[number];
    response: response;
}>;
export type PaymentFailedPayload<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = Readonly<{
    challenge?: Challenge.Challenge | undefined;
    challenges?: readonly Challenge.Challenge[] | undefined;
    error: unknown;
    init?: from.RequestInit<methods> | undefined;
    input?: RequestInfo | URL | undefined;
    method?: methods[number] | undefined;
    response?: response | undefined;
}>;
export type ClientEventDispatcher<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response> = {
    emit<name extends Exclude<ClientEventName<methods, response>, '*'>>(name: name, payload: ClientEventMap<methods, response>[name]): Promise<ClientEventResult<methods, name, response>>;
    on<name extends ClientEventName<methods, response>>(name: name, handler: ClientEventHandler<methods, name, response>): Unsubscribe;
};
/**
 * Creates a fetch wrapper that automatically handles 402 Payment Required responses.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const fetch = Fetch.from({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Use the wrapped fetch — handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 *
 */
export declare function from<const methods extends readonly Method.AnyClient[]>(config: from.Config<methods>): from.Fetch<methods>;
/** Union of all context types from all methods that have context schemas. */
type AnyContextFor<methods extends readonly Method.AnyClient[]> = {
    [K in keyof methods]: NonNullable<methods[K]['context']> extends infer ctx ? ctx extends z.ZodMiniType ? z.input<ctx> : undefined : undefined;
}[number];
export declare namespace from {
    type Config<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = {
        /** Resolved `Accept-Payment` header and selection preferences. */
        acceptPayment?: AcceptPayment.Resolved<methods> | undefined;
        /** Controls when `Accept-Payment` is injected. @default 'always' */
        acceptPaymentPolicy?: 'always' | 'same-origin' | 'never' | {
            origins: readonly string[];
        } | undefined;
        /** Custom fetch function to wrap. Defaults to `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch;
        /** Advanced shared event dispatcher. `challenge.received` handlers run before `onChallenge`; the first non-empty credential returned by a handler skips `onChallenge`. */
        eventDispatcher?: ClientEventDispatcher<methods, any> | undefined;
        /** Maximum number of payment challenge retries after the initial response. @default 3 */
        maxPaymentRetries?: number | undefined;
        /** Array of methods to use. */
        methods: methods;
        /** Called when a 402 challenge is received and no event handler supplies a credential. */
        onChallenge?: ((challenge: Challenge.Challenge, helpers: {
            createCredential: (context?: AnyContextFor<methods>) => Promise<string>;
        }) => Promise<string | undefined>) | undefined;
        /** Filters and sorts supported challenges before credential creation. */
        orderChallenges?: AcceptPayment.OrderChallenges<methods> | undefined;
        /** Transport to use for challenge extraction and credential attachment. */
        transport?: Transport.AnyTransport | undefined;
    };
    type Fetch<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = (input: RequestInfo | URL, init?: RequestInit<methods>) => Promise<Response>;
    type RequestInit<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = globalThis.RequestInit & {
        /** Context to pass to the method intent's createCredential. */
        context?: AnyContextFor<methods>;
        /** Request-local challenge filtering and sorting. */
        orderChallenges?: AcceptPayment.OrderChallenges<methods> | undefined;
    };
}
/**
 * Replaces the global `fetch` with a payment-aware wrapper.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * Fetch.polyfill({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Global fetch now handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 */
export declare function polyfill<const methods extends readonly Method.AnyClient[]>(config: polyfill.Config<methods>): void;
export declare namespace polyfill {
    type Config<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[]> = from.Config<methods>;
}
/**
 * Restores the original `fetch` after calling `polyfill`.
 *
 * @example
 * ```ts
 * import { Fetch } from 'mppx/client'
 *
 * Fetch.polyfill({ methods: [...] })
 *
 * // ... use payment-aware fetch ...
 *
 * Fetch.restore()
 * ```
 */
export declare function restore(): void;
/** @internal Normalizes headers to a plain object for spreading. */
export declare function normalizeHeaders(headers: unknown): Record<string, string>;
/**
 * Creates a typed client payment event dispatcher.
 *
 * `challenge.received` handlers run before `onChallenge`; the first non-empty
 * credential returned by a handler wins. Observation handlers are isolated, so
 * thrown listener errors do not stop sibling listeners or payment flow.
 */
export declare function createEventDispatcher<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], response = Response>(): ClientEventDispatcher<methods, response>;
/** @internal */
/** @internal */
export declare function unwrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch;
/** @internal */
export declare function validateCredentialHeaderValue(credential: string): void;
/** @internal */
/** @internal */
export declare function shouldInjectForPolicy(input: RequestInfo | URL, policy: NonNullable<from.Config['acceptPaymentPolicy']>): boolean;
export {};
//# sourceMappingURL=Fetch.d.ts.map