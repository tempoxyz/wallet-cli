/** Extracts the pathname from a URL, stripping the optional `basePath` prefix. Returns `null` if the path doesn't match. */
export declare function pathname(url: URL, basePath?: string): string | null;
/** Splits a `/{serviceId}/rest/of/path` pathname into its service ID and upstream path. */
export declare function parse(pathname: string): {
    serviceId: string;
    upstreamPath: string;
} | null;
/** Finds the first route matching both the HTTP method and path (via `URLPattern`). */
export declare function match(routes: Record<string, unknown>, method: string, path: string): {
    key: string;
    value: unknown;
} | null;
/** Finds the first route matching the path, ignoring the HTTP method. Optional `filter` predicate can exclude routes. */
export declare function matchPath(routes: Record<string, unknown>, path: string, filter?: (value: unknown) => boolean): {
    key: string;
    value: unknown;
} | null;
/** Parses a proxy route key like `"POST /v1/messages"` into method + pathname pattern. */
export declare function parseRouteKey(key: string): {
    method: string | undefined;
    pattern: string;
};
//# sourceMappingURL=Route.d.ts.map