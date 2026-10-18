import type * as Method from '../../Method.js';
declare const relayErrorCode: readonly ['already_used', 'broadcast_failed', 'expired', 'invalid_payment', 'insufficient_funds', 'policy_denied', 'screen_rejected', 'simulation_failed', 'temporarily_unavailable', 'unsupported', 'unknown'];
type RelayErrorCode = (typeof relayErrorCode)[number];
/**
 * Configures a Tempo payment method to use Tempo API's MPP relay.
 *
 * The adapter preserves the supplied method's challenge configuration while
 * delegating validation and finalization to `/v1/mpp/validate` and
 * `/v1/mpp/broadcast`. The relay receives every submitted credential: it
 * broadcasts pull transactions and finalizes push transaction hashes without
 * sending them again.
 *
 * @internal
 */
export declare function configure<const intent extends Method.Method>(method: Method.Server<intent>, options: configure.Options): configure.Adapter<intent>;
export declare namespace configure {
    /**
     * Server method augmented with Tempo API validation and broadcast hooks.
     *
     * The legacy `verify` method validates and broadcasts in one call.
     */
    type Adapter<intent extends Method.Method> = Omit<Method.Server<intent>, 'broadcast' | 'validate'> & {
        /** Delegates payment finalization to Tempo API's relay. */
        broadcast: Method.BroadcastFn<intent>;
        /** Validates the credential through Tempo API. */
        validate: Method.ValidateFn<intent>;
    };
    /**
     * Tempo API relay configuration for server-side Tempo charges.
     *
     * The adapter sends every credential to the relay for finalization. The
     * relay broadcasts pull credentials, while it recognizes a push credential
     * as an already-broadcast transaction and returns its receipt without
     * sending it again.
     */
    type Options = {
        /** Tempo API key with the `mpp:write` scope. */
        apiKey: string;
        /** Fetch implementation used to call Tempo API. */
        fetch?: typeof globalThis.fetch | undefined;
        /** Tempo API base URL, including an optional path prefix. @default 'https://api.tempo.xyz' */
        apiBaseUrl?: string | undefined;
    };
    /** Stable failure codes returned by Tempo API's MPP relay. */
    type ErrorCode = RelayErrorCode;
    /** Safe relay error details exposed in Payment Auth problem details. */
    type ErrorDetails = {
        code: 'already_used' | 'broadcast_failed' | 'insufficient_funds' | 'invalid_payment';
    } | {
        code: 'simulation_failed' | 'unsupported';
    } | {
        code: 'temporarily_unavailable';
        retry: 'same_credential';
    };
}
export {};
//# sourceMappingURL=Relay.d.ts.map