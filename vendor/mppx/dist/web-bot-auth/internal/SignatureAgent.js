/** Returns the canonical origin for a Web Bot Auth directory identifier. */
export function directoryOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash)
            return undefined;
        return url.origin;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=SignatureAgent.js.map