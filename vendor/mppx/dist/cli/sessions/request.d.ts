import type * as Challenge from '../../Challenge.js';
import type { TempoSessionChallenge } from '../../tempo/session/client/Transports.js';
import { type Network } from '../utils.js';
import { type SessionRegistry, type SessionSelection } from './store.js';
/** CLI options needed to run a persistent Tempo session request. */
export type PersistentSessionRequestOptions = {
    account?: string | undefined;
    fail?: boolean | undefined;
    include?: boolean | undefined;
    network?: Network | undefined;
    rpcUrl?: string | undefined;
    session: string;
    silent: boolean;
    verbose: number;
};
/** Inputs for a persistent request after challenge selection and confirmation. */
export type PersistentSessionRequestParameters = {
    challenge: TempoSessionChallenge;
    challengeResponse: Response;
    credentialContext?: unknown;
    endpoint: string;
    fetch: typeof globalThis.fetch;
    fetchInput: RequestInfo | URL;
    init: RequestInit;
    info(message: string): void;
    methodOptions: Record<string, string>;
    options: PersistentSessionRequestOptions;
    registry?: SessionRegistry | undefined;
};
/** Resolves `--session` and the `-M channel=` compatibility alias. */
export declare function resolveSessionSelection(session: string, channelAlias: string | undefined): SessionSelection;
/** @internal Resolves whether the CLI accepts a server-advertised custom escrow. */
export declare function resolveAllowCustomEscrow(methodOptions: Record<string, string>): boolean | undefined;
/** @internal Resolves the manager deposit cap in human-readable token units. */
export declare function resolveSessionMaxDeposit(challenge: Challenge.Challenge, methodOptions: Record<string, string>, testnet: boolean): string | undefined;
/** Runs one manager-backed request while holding the payer and payment-scope lock. */
export declare function runPersistentSessionRequest(parameters: PersistentSessionRequestParameters): Promise<void>;
//# sourceMappingURL=request.d.ts.map