import { type Chain, type Client } from 'viem';
import type { MaybePromise } from '../internal/types.js';
import * as RemoteFeePayer from '../tempo/internal/remote-fee-payer.js';
/** Creates an HTTP transport for a configured remote fee-payer service. */
export declare function remoteFeePayerTransport(config: RemoteFeePayer.Config, options?: {
    retryCount?: number | undefined;
}): import("viem").HttpTransport<undefined, false>;
export declare function getResolver(parameters: getResolver.Parameters & {
    /** Default chain to use if not provided. */
    chain?: Chain | undefined;
    /** Remote fee-payer configuration. When set, the transport is wrapped with `withFeePayer`. */
    remoteFeePayer?: RemoteFeePayer.Config | undefined;
    /** RPC URLs keyed by chain ID. */
    rpcUrl?: ({
        [chainId: number]: string;
    } & object) | undefined;
}): (parameters: {
    chainId?: number | undefined;
}) => MaybePromise<Client>;
export declare namespace getResolver {
    type Parameters = {
        /** Function that returns a client for the given chain ID. */
        getClient?: ((parameters: {
            chainId?: number | undefined;
        }) => MaybePromise<Client>) | undefined;
    };
}
/** Rejects a resolved client whose known chain conflicts with the requested payment chain. */
export declare function assertChainId(client: Client, chainId: number | undefined): void;
/** Rejects disallowed or unknown payment chains when an allowlist is configured. */
export declare function assertAllowedChainId(allowedChainIds: readonly number[] | undefined, chainId: number | undefined): void;
//# sourceMappingURL=Client.d.ts.map