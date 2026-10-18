import type { SessionReceipt } from '../precompile/Protocol.js';
import type { SessionReceiptPredicate } from './Runtime.js';
import type { ActiveSocketSession } from './Transports.js';
/** Dependencies needed by receipt coordination to inspect active socket state. */
export type CreateSessionReceiptCoordinatorParameters = {
    /** Returns the active socket session, when a paid WebSocket is open. */
    getSocketSession(): ActiveSocketSession | null;
};
/** Coordinates receipt waiters plus WebSocket close-ready receipt caching. */
export type SessionReceiptCoordinator = {
    /** Rejects a pending close-ready wait, when present. */
    rejectCloseReady(error: Error): void;
    /** Rejects a pending payment receipt wait, when present. */
    rejectReceipt(error: Error): void;
    /** Resolves a close-ready wait and caches matching socket close-ready receipts. */
    settleCloseReady(receipt: SessionReceipt): void;
    /** Resolves a payment receipt wait when its predicate accepts the receipt. */
    settleReceipt(receipt: SessionReceipt): void;
    /** Waits for a close-ready receipt, reusing the cached active socket receipt when available. */
    waitForCloseReady(): Promise<SessionReceipt>;
    /** Waits for a payment receipt. Only one receipt wait may be active at a time. */
    waitForReceipt(predicate?: SessionReceiptPredicate): Promise<SessionReceipt>;
};
/** Creates the receipt coordinator used by HTTP/SSE/WebSocket session manager flows. */
export declare function createSessionReceiptCoordinator(parameters: CreateSessionReceiptCoordinatorParameters): SessionReceiptCoordinator;
//# sourceMappingURL=ReceiptCoordinator.d.ts.map