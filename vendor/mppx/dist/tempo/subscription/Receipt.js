/** Creates a subscription receipt from persisted subscription fields. */
export function createSubscriptionReceipt(parameters) {
    return {
        method: 'tempo',
        reference: parameters.reference,
        status: 'success',
        subscriptionId: parameters.subscriptionId,
        timestamp: parameters.timestamp,
        ...(parameters.externalId ? { externalId: parameters.externalId } : {}),
    };
}
/** Converts a stored subscription record into a receipt. */
export function fromRecord(record) {
    return createSubscriptionReceipt(record);
}
//# sourceMappingURL=Receipt.js.map