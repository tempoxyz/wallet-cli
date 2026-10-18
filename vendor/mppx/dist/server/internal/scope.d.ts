/** Reserved `meta` key used for mppx-managed route/resource scope binding. */
export declare const reservedMetaKey = "_mppx_scope";
/** Attaches a trusted adapter-derived scope to a Request for this process only. */
export declare function attach(request: Request, scope: string): Request;
/** Reads a previously attached trusted adapter-derived scope from a Request. */
export declare function get(request: Request): string | undefined;
/** Returns the reserved mppx scope value from challenge metadata, if present. */
export declare function read(meta: Record<string, string> | undefined): string | undefined;
/**
 * Merges the public `scope` option into challenge metadata.
 *
 * Throws when both `scope` and `meta._mppx_scope` are provided with different
 * values so callers have a single authoritative way to bind route scope.
 */
export declare function merge(parameters: {
    meta?: Record<string, string> | undefined;
    scope?: string | undefined;
}): Record<string, string> | undefined;
//# sourceMappingURL=scope.d.ts.map