/** Returns whether a value is remote fee-payer configuration. */
export function is(value) {
    return (typeof value === 'object' && value !== null && 'url' in value && typeof value.url === 'string');
}
/** Normalizes remote fee-payer string and object inputs. */
export function from(value) {
    if (typeof value === 'string')
        return { url: value };
    if (is(value))
        return value;
    return undefined;
}
/** Returns a cloned header record while reserving JSON content type for MPPX. */
export function resolveHeaders(config) {
    return Object.fromEntries(Object.entries(config.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'content-type'));
}
//# sourceMappingURL=remote-fee-payer.js.map