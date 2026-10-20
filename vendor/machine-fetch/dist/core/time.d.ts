/** Current Unix time in whole seconds. */
export declare function nowSeconds(): number;
/** Milliseconds remaining until a Unix-seconds deadline, never negative. */
export declare function untilDeadline(deadline: number): number;
/** Stands in for an omitted signal, so cancellation paths need no undefined checks. */
export declare const neverAborted: AbortSignal;
/** Resolves after a delay, or rejects with the signal's reason when it aborts first. */
export declare function sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
/**
 * Runs work with a linked abort signal and settles when the work finishes, the timeout elapses, or
 * the outer signal aborts, whichever comes first. Late work results are ignored.
 */
export declare function withTimeout<value>(run: (signal: AbortSignal) => Promise<value>, options: Readonly<{
    milliseconds: number;
    signal?: AbortSignal | undefined;
    timeoutError(): Error;
    /** Maps the outer abort reason to the rejection value. Defaults to the reason itself. */
    abortError?(reason: unknown): unknown;
}>): Promise<value>;
