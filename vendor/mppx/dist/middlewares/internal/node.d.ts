/** Parsed Node framework request fields needed to construct a Fetch request. */
export type ParsedRequest = {
    body?: unknown;
    headers: Record<string, string | string[] | undefined>;
    method: string;
    url: string;
};
/** Converts a parsed Node framework request into the Fetch request consumed by mppx core. */
export declare function toRequest(request: ParsedRequest): Request;
//# sourceMappingURL=node.d.ts.map