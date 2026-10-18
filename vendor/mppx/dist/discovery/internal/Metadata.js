/** Returns every explicitly configured offer from discovery metadata. */
export function offers(metadata) {
    if (isComposed(metadata))
        return metadata.offers;
    return [metadata];
}
/** Converts configured handler metadata into a discovery payment offer. */
export function paymentOffer(metadata) {
    const { _canonicalRequest: request, intent, name: method } = metadata;
    const methodDetails = (request.methodDetails ?? {});
    const amount = pickString(request.amount) ?? pickString(methodDetails.amount) ?? null;
    const currency = pickString(request.currency) ?? pickString(methodDetails.currency);
    const description = pickString(metadata.description) ?? pickString(request.description);
    const offer = {
        amount,
        ...(currency ? { currency } : {}),
        ...(description ? { description } : {}),
        intent,
        method,
    };
    // Preserve extension fields emitted by method request schemas.
    const reserved = new Set(['amount', 'currency', 'description', 'methodDetails']);
    for (const [key, value] of Object.entries(request)) {
        if (!reserved.has(key) && value !== undefined)
            offer[key] = value;
    }
    return offer;
}
/** Returns whether metadata represents a composed handler. */
export function isComposed(metadata) {
    return 'offers' in metadata && !('_canonicalRequest' in metadata);
}
function pickString(value) {
    return typeof value === 'string' ? value : undefined;
}
//# sourceMappingURL=Metadata.js.map