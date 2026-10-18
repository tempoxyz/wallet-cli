/**
 * Maps with bounded concurrency, isolating failures. Declined (undefined) results are dropped;
 * rejections are collected in completion order. Callers validate concurrency.
 */
export async function settleConcurrent(values, concurrency, map) {
    // Stryker disable next-line ArrayDeclaration: preallocation only avoids growth; filter drops holes either way
    const settled = new Array(values.length);
    const failures = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            try {
                settled[index] = await map(values[index]);
            }
            catch (cause) {
                failures.push(cause);
            }
        }
    }));
    return { results: settled.filter((result) => result !== undefined), failures };
}
/** Preserves a sole failure as an error cause, or aggregates several. */
export function failureCause(failures, message) {
    return failures.length > 1 ? new AggregateError(failures, message) : failures[0];
}
//# sourceMappingURL=concurrent.js.map