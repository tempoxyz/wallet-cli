import type * as Attestation from '../attestation/Types.js';
import type * as Challenge from '../Challenge.js';
import * as AcceptPayment from '../internal/AcceptPayment.js';
import type * as Method from '../Method.js';
import type * as z from '../zod.js';
import * as Fetch from './internal/Fetch.js';
import * as Transport from './Transport.js';
export type Methods = readonly (Method.AnyClient | readonly Method.AnyClient[])[];
type EventResponseOf<transport extends Transport.AnyTransport> = Response | Transport.ResponseOf<transport>;
/**
 * A selected payment that can be inspected before its credential is created.
 *
 * Prepared payments retain transport-local protocol state and are not serializable.
 */
export type PreparedPayment<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], transport extends Transport.AnyTransport = Transport.Transport> = Readonly<{
    /** The selected payment challenge. */
    challenge: Challenge.Challenge;
    /** All supported payment challenges extracted from the response. */
    challenges: readonly Challenge.Challenge[];
    /** Creates the selected challenge's credential at most once. */
    createCredential: (context?: AnyContextFor<methods> | undefined) => Promise<string>;
    /** The configured client method selected for the challenge. */
    method: methods[number];
    /** Attaches a credential using the protocol that produced the selected challenge. */
    setCredential: (request: Transport.RequestOf<transport>, credential: string) => Transport.RequestOf<transport>;
}>;
/** An HTTP request prepared together with its response and optional payment. */
export type PreparedRequest<methods extends readonly Method.AnyClient[], requirePayment extends boolean = false> = Readonly<{
    /** Exact request that produced {@link response}. */
    request: Request;
    /** Response returned for {@link request}. */
    response: Response;
    /** Redirects followed before receiving {@link response}. */
    redirects: readonly PreparedRequest.Redirect[];
    /** Selected payment when the response requires payment. */
    payment: requirePayment extends true ? PreparedRequest.Payment<methods> : PreparedRequest.Payment<methods> | undefined;
}>;
export declare namespace PreparedRequest {
    /** A request-bound payment that can be inspected or paid. */
    type Payment<methods extends readonly Method.AnyClient[]> = Readonly<PreparedPayment<methods, Transport.Transport<RequestInit, Response>> & {
        /** Creates and sends a credential to the prepared request without following redirects. */
        pay: (context?: AnyContextFor<methods> | undefined) => Promise<Response>;
    }>;
    /** A redirect followed while discovering a payment challenge. */
    type Redirect = Readonly<{
        from: string;
        status: number;
        to: string;
    }>;
}
/**
 * Client-side payment handler.
 */
export type Mppx<methods extends Methods = Methods, transport extends Transport.AnyTransport = Transport.Transport> = {
    /** Payment-aware fetch function that automatically handles 402 responses. */
    fetch: Fetch.from.Fetch<FlattenMethods<methods>>;
    /** The original, unwrapped fetch function (pre-polyfill). Useful when you need to make requests that should not be intercepted (e.g. 402 probes for websocket auth). */
    rawFetch: typeof globalThis.fetch;
    /** Methods to configure. */
    methods: FlattenMethods<methods>;
    /** The transport used. */
    transport: transport;
    /**
     * Selects a payment challenge without creating its credential.
     *
     * @example
     * ```ts
     * const request = { method: 'POST' }
     * const response = await mppx.rawFetch('/resource', request)
     * const payment = await mppx.preparePayment(response, { request })
     * inspect(payment.challenge)
     * const credential = await payment.createCredential()
     * const init = payment.setCredential(request, credential)
     * ```
     */
    preparePayment: (response: Transport.ResponseOf<transport>, options?: preparePayment.Options<FlattenMethods<methods>, transport> | undefined) => Promise<PreparedPayment<FlattenMethods<methods>, transport>>;
    /**
     * Follows safe pre-payment redirects and returns the response with its exact request. When the
     * response requires payment, prepares its selected challenge without creating a credential.
     * Credential-bearing requests never follow redirects. Requires a runtime that exposes manual
     * redirect responses; browsers return opaque redirects and are not supported.
     */
    prepareRequest: transport extends Transport.Transport<RequestInit, Response> ? {
        <const requirePayment extends boolean>(input: RequestInfo | URL, init: RequestInit | undefined, options: prepareRequest.Options<FlattenMethods<methods>, requirePayment> & {
            requirePayment: requirePayment;
        }): Promise<PreparedRequest<FlattenMethods<methods>, requirePayment>>;
        (input: RequestInfo | URL, init?: RequestInit | undefined, options?: prepareRequest.Options<FlattenMethods<methods>> | undefined): Promise<PreparedRequest<FlattenMethods<methods>>>;
    } : never;
    /** Creates a credential from a payment-required response by routing to the correct method. */
    createCredential: (response: Transport.ResponseOf<transport>, context?: AnyContextFor<FlattenMethods<methods>> | undefined, options?: createCredential.Options<FlattenMethods<methods>, transport> | undefined) => Promise<string>;
    /** Register a client event handler by canonical event name. */
    on<name extends Fetch.ClientEventName<FlattenMethods<methods>, EventResponseOf<transport>>>(name: name, handler: Fetch.ClientEventHandler<FlattenMethods<methods>, name, EventResponseOf<transport>>): Fetch.Unsubscribe;
    /** Register a handler for received payment challenges. */
    onChallengeReceived(handler: Fetch.ClientEventHandler<FlattenMethods<methods>, 'challenge.received', EventResponseOf<transport>>): Fetch.Unsubscribe;
    /** Register a handler for created credentials. */
    onCredentialCreated(handler: Fetch.ClientEventHandler<FlattenMethods<methods>, 'credential.created', EventResponseOf<transport>>): Fetch.Unsubscribe;
    /** Register a handler for failed automatic payment handling. */
    onPaymentFailed(handler: Fetch.ClientEventHandler<FlattenMethods<methods>, 'payment.failed', EventResponseOf<transport>>): Fetch.Unsubscribe;
    /** Register a handler for payment retry responses. */
    onPaymentResponse(handler: Fetch.ClientEventHandler<FlattenMethods<methods>, 'payment.response', EventResponseOf<transport>>): Fetch.Unsubscribe;
};
/**
 * Creates a client-side payment handler from an array of methods.
 *
 * Returns a payment handler with a `fetch` function that automatically handles
 * 402 Payment Required responses. By default, also polyfills `globalThis.fetch`.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo({ account })],
 * })
 *
 * // Use the returned fetch — handles 402 automatically
 * const res = await mppx.fetch('/resource')
 *
 * // Or use globalThis.fetch (polyfilled by default)
 * const res2 = await fetch('/resource')
 * ```
 */
export declare function create<const methods extends Methods, const transport extends Transport.Transport<any, any> = Transport.Transport<RequestInit, Response>>(config: create.Config<methods, transport>): Mppx<methods, transport>;
export declare namespace preparePayment {
    /** Options for selecting a payment without creating its credential. */
    type Options<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], transport extends Transport.AnyTransport = Transport.Transport> = createCredential.Options<methods, transport>;
}
export declare namespace prepareRequest {
    /** Options for preparing a request-bound payment. */
    type Options<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], requirePayment extends boolean = false> = Omit<preparePayment.Options<methods, Transport.Transport<RequestInit, Response>>, 'request'> & {
        /** Maximum redirects followed before rejecting the request. @default 20 */
        maxRedirects?: number | undefined;
        /** Throw when the response does not require payment. @default false */
        requirePayment?: requirePayment | undefined;
    };
}
export declare namespace createCredential {
    type Options<methods extends readonly Method.AnyClient[] = readonly Method.AnyClient[], transport extends Transport.AnyTransport = Transport.Transport> = {
        /** Request-local Accept-Payment override for manual rawFetch + createCredential flows. */
        acceptPayment?: string | readonly AcceptPayment.Entry[] | undefined;
        /** Request-local challenge filtering and sorting. */
        orderChallenges?: AcceptPayment.OrderChallenges<methods> | undefined;
        /** Request that produced the response, when challenge extraction depends on both values. */
        request?: Transport.RequestOf<transport> | undefined;
    };
}
/**
 * Restores the original `fetch` after `create()` polyfilled it.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/client'
 *
 * Mppx.create({ methods: [tempo({ account })] })
 *
 * // ... use payment-aware fetch ...
 *
 * Mppx.restore()
 * ```
 */
export declare function restore(): void;
export declare namespace create {
    type Config<methods extends Methods = Methods, transport extends Transport.AnyTransport = Transport.Transport> = {
        /** Request-attestation signers applied to every outbound HTTP attempt. */
        attestation?: transport extends Transport.Transport<RequestInit, Response> ? Attestation.SignerMap | undefined : never;
        /** Controls when `Accept-Payment` is injected. */
        acceptPaymentPolicy?: Fetch.from.Config['acceptPaymentPolicy'] | undefined;
        /** Custom fetch function to wrap. Defaults to `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch;
        /** Called when a 402 challenge is received and no event handler supplies a credential. */
        onChallenge?: ((challenge: Challenge.Challenge, helpers: {
            createCredential: (context?: AnyContextFor<FlattenMethods<methods>>) => Promise<string>;
        }) => Promise<string | undefined>) | undefined;
        /** Maximum number of payment challenge retries after the initial response. @default 3 */
        maxPaymentRetries?: Fetch.from.Config['maxPaymentRetries'] | undefined;
        /** Filters and sorts supported challenges before credential creation. */
        orderChallenges?: AcceptPayment.OrderChallenges<FlattenMethods<methods>> | undefined;
        /** Client-declared supported payment methods, keyed by typed `method/intent` strings. */
        paymentPreferences?: AcceptPayment.Config<FlattenMethods<methods>> | undefined;
        /** Array of methods to use. Accepts individual clients or tuples (e.g. from `tempo()`). */
        methods: methods;
        /** Whether to polyfill `globalThis.fetch` with the payment-aware wrapper. @default true */
        polyfill?: boolean | undefined;
        /** Transport to use (defaults to HTTP). */
        transport?: transport | undefined;
    };
}
/**
 * Union of all context types from all methods that have context schemas.
 * @internal
 */
type AnyContextFor<methods extends readonly Method.AnyClient[]> = {
    [method in keyof methods]: NonNullable<methods[method]['context']> extends infer ctx ? ctx extends z.ZodMiniType ? z.input<ctx> : undefined : undefined;
}[number];
/**
 * Flattens a methods config tuple, preserving positional types.
 * @internal
 */
type FlattenMethods<methods extends Methods> = methods extends readonly [
    infer head,
    ...infer tail extends Methods
] ? head extends readonly Method.AnyClient[] ? readonly [...head, ...FlattenMethods<tail>] : head extends Method.AnyClient ? readonly [head, ...FlattenMethods<tail>] : never : readonly [];
export {};
//# sourceMappingURL=Mppx.d.ts.map