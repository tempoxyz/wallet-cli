import * as Store from '../../Store.js';
import type { SubscriptionAccessKeyRecord, SubscriptionRecord } from './Types.js';
/** Subscription-aware wrapper around a generic key-value store. */
export type SubscriptionStore = {
    /** Runs activation once for a challenge and resolved lookup key. */
    activate<result extends {
        subscription: SubscriptionRecord;
    }>(parameters: ActivateParameters<result>): Promise<ActivateResult<result>>;
    /** Looks up a subscription by subscription ID. */
    get(subscriptionId: string): Promise<SubscriptionRecord | null>;
    /** Looks up a generated access key for a resolved request key. */
    getAccessKey(key: string): Promise<SubscriptionAccessKeyRecord | null>;
    /** Looks up a generated access key by its public access key address. */
    getAccessKeyByAddress(address: string): Promise<SubscriptionAccessKeyRecord | null>;
    /** Looks up the active subscription for a resolved request key. */
    getByKey(key: string): Promise<SubscriptionRecord | null>;
    /** Gets or creates the server-owned access key for a resolved request key. */
    getOrCreateAccessKey(key: string): Promise<SubscriptionAccessKeyRecord>;
    /** Upserts a subscription record and marks it as active for its lookup key. */
    put(record: SubscriptionRecord): Promise<void>;
    /** Runs renewal once for a subscription period. */
    renew<result extends {
        subscription: SubscriptionRecord;
    }>(parameters: RenewParameters<result>): Promise<RenewResult<result>>;
};
type ActivateParameters<result extends {
    subscription: SubscriptionRecord;
}> = {
    challengeId: string;
    create: () => Promise<result>;
    isReusable?: ((subscription: SubscriptionRecord) => boolean) | undefined;
    lookupKey: string;
};
export type ActivateResult<result extends {
    subscription: SubscriptionRecord;
}> = {
    status: 'activated';
    result: result;
} | {
    status: 'claimMismatch';
} | {
    status: 'existing';
    subscription: SubscriptionRecord;
} | {
    status: 'inFlight';
} | {
    status: 'replayed';
};
type RenewParameters<result extends {
    subscription: SubscriptionRecord;
}> = {
    inFlightReference: string;
    periodIndex: number;
    renew: (parameters: {
        inFlightReference: string;
        periodIndex: number;
        subscription: SubscriptionRecord;
    }) => Promise<result>;
    subscriptionId: string;
};
export type RenewResult<result extends {
    subscription: SubscriptionRecord;
}> = {
    status: 'charged';
    subscription: SubscriptionRecord;
} | {
    status: 'inFlight';
    subscription: SubscriptionRecord;
} | {
    status: 'missing';
} | {
    status: 'renewed';
    result: result;
} | {
    status: 'superseded';
    subscription: SubscriptionRecord;
} | {
    status: 'claimMismatch';
};
/** Wraps a generic key-value {@link Store.Store} with subscription-specific accessors. */
export declare function fromStore(store: Store.AtomicStore<Record<string, unknown>>, options?: fromStore.Options): SubscriptionStore;
export declare namespace fromStore {
    type Options = {
        /** Key prefix for server-owned subscription access keys. @default `'tempo:subscription:access-key:'` */
        accessKeyPrefix?: string | undefined;
        /** Key prefix for resolved subscription activation locks. @default `'tempo:subscription:activation:'` */
        activationPrefix?: string | undefined;
        /** Milliseconds before a stuck activation lock can be replaced. @default `900000` */
        activationTimeoutMs?: number | undefined;
        /** Key prefix for single-use activation credential markers. @default `'tempo:subscription:credential:'` */
        credentialPrefix?: string | undefined;
        /** Key prefix for subscription records. @default `'tempo:subscription:record:'` */
        recordPrefix?: string | undefined;
        /** Milliseconds before a stuck renewal lock can be replaced. @default `900000` */
        renewalTimeoutMs?: number | undefined;
        /** Key prefix for resolved request keys. @default `'tempo:subscription:key:'` */
        keyPrefix?: string | undefined;
    };
}
export {};
//# sourceMappingURL=Store.d.ts.map