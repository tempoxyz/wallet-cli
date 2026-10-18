import type * as Challenge from '../../Challenge.js';
import type { MaybePromise } from '../../internal/types.js';
import type * as Method from '../../Method.js';
export type AttemptOutcome = {
    challenges?: readonly Challenge.Challenge[] | undefined;
    response?: Response | undefined;
    status: 'accepted' | 'pending' | 'rejected';
};
export type Attempt = {
    /** Re-runs method preparation when serialized state changed before signing. */
    prepare: () => Promise<void>;
    /** Settles state created for one credential attempt. */
    settle?: ((outcome: AttemptOutcome) => MaybePromise<boolean>) | undefined;
};
/** Inputs available when a client method handles a successful paid response. */
export type HandlerParameters = {
    challenge: Challenge.Challenge;
    credential: string;
    fetch: typeof globalThis.fetch;
    headers: Headers;
    input: RequestInfo | URL;
    refetch?: (() => Promise<Response>) | undefined;
    response: Response;
    signal?: AbortSignal | undefined;
};
/** Internal client-method response adapter. */
export type Handler = (parameters: HandlerParameters) => MaybePromise<Response>;
/** Registers an internal response adapter without changing the public method shape. */
export declare function register<const method extends Method.AnyClient>(method: method, handler: Handler): method;
/** Removes response handling from a method whose caller owns the response lifecycle. */
export declare function unregister(method: Method.AnyClient): void;
/** Adds response lifecycle state to internal credential parameters. */
export declare function attachAttempt(method: Method.AnyClient, parameters: object, attempt: Attempt): void;
/** Reads response lifecycle state when Fetch owns this credential. */
export declare function getAttempt(parameters: object): Attempt | undefined;
/** Lets the selected client method handle a successful paid response. */
export declare function handle(method: Method.AnyClient, parameters: HandlerParameters): Promise<Response>;
//# sourceMappingURL=MethodResponse.d.ts.map