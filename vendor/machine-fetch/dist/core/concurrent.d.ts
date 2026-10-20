/**
 * Maps with bounded concurrency, isolating failures. Declined (undefined) results are dropped;
 * rejections are collected in completion order. Callers validate concurrency.
 */
export declare function settleConcurrent<input, output>(values: readonly input[], concurrency: number, map: (value: input) => Promise<output | undefined>): Promise<Readonly<{
    results: output[];
    failures: unknown[];
}>>;
/** Preserves a sole failure as an error cause, or aggregates several. */
export declare function failureCause(failures: readonly unknown[], message: string): unknown;
