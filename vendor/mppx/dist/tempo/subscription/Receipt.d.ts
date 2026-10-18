import type { SubscriptionRecord, SubscriptionReceipt } from './Types.js';
/** Creates a subscription receipt from persisted subscription fields. */
export declare function createSubscriptionReceipt(parameters: createSubscriptionReceipt.Parameters): SubscriptionReceipt;
export declare namespace createSubscriptionReceipt {
    /** Fields required to build a subscription receipt. */
    type Parameters = Pick<SubscriptionRecord, 'externalId' | 'reference' | 'subscriptionId' | 'timestamp'>;
}
/** Converts a stored subscription record into a receipt. */
export declare function fromRecord(record: SubscriptionRecord): SubscriptionReceipt;
//# sourceMappingURL=Receipt.d.ts.map