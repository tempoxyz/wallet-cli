import type { ChannelEntry } from '../ChannelOps.js';
import type { PaymentResponse, SessionManager } from '../SessionManager.js';
import type { SseResponseOptions, TempoSessionChallenge } from '../Transports.js';
type RehydrateParameters = {
    channel: ChannelEntry;
    challenge: TempoSessionChallenge;
    input: RequestInfo | URL;
    spent: bigint;
};
type SessionManagerInternals = {
    consumeSseResponse(input: RequestInfo | URL, response: PaymentResponse, options?: SseResponseOptions | undefined): AsyncIterable<string>;
    rehydrate(parameters: RehydrateParameters): void;
};
/** @internal Registers private transport and recovery hooks for a session manager. */
export declare function registerSessionManagerInternals(manager: SessionManager, value: SessionManagerInternals): void;
/** @internal Returns private transport and recovery hooks for a session manager. */
export declare function getSessionManagerInternals(manager: SessionManager): SessionManagerInternals;
export {};
//# sourceMappingURL=SessionManager.d.ts.map