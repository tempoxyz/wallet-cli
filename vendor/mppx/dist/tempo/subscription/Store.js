import { Secp256k1 } from 'ox';
import { Account as TempoAccount } from 'viem/tempo';
const defaultRecordPrefix = 'tempo:subscription:record:';
const defaultKeyPrefix = 'tempo:subscription:key:';
const defaultActivationPrefix = 'tempo:subscription:activation:';
const defaultAccessKeyPrefix = 'tempo:subscription:access-key:';
const defaultCredentialPrefix = 'tempo:subscription:credential:';
const defaultActivationTimeoutMs = 15 * 60 * 1_000;
const defaultRenewalTimeoutMs = 15 * 60 * 1_000;
/** Wraps a generic key-value {@link Store.Store} with subscription-specific accessors. */
export function fromStore(store, options) {
    const { accessKeyPrefix = defaultAccessKeyPrefix, activationPrefix = defaultActivationPrefix, activationTimeoutMs = defaultActivationTimeoutMs, credentialPrefix = defaultCredentialPrefix, keyPrefix = defaultKeyPrefix, recordPrefix = defaultRecordPrefix, renewalTimeoutMs = defaultRenewalTimeoutMs, } = options ?? {};
    function recordKey(subscriptionId) {
        return `${recordPrefix}${subscriptionId}`;
    }
    function activationKey(key) {
        return `${activationPrefix}${key}`;
    }
    function credentialKey(challengeId) {
        return `${credentialPrefix}${challengeId}`;
    }
    function accessKeyKey(key) {
        return `${accessKeyPrefix}${key}`;
    }
    function accessKeyAddressKey(address) {
        return `${accessKeyPrefix}address:${address.toLowerCase()}`;
    }
    function lookupRecordKey(key) {
        return `${keyPrefix}${key}`;
    }
    async function getByLookupKey(key) {
        const subscriptionId = (await store.get(lookupRecordKey(key)));
        if (!subscriptionId)
            return null;
        return (await store.get(recordKey(subscriptionId)));
    }
    async function clearRenewalState(subscriptionId, periodIndex, attempt) {
        await store.update(recordKey(subscriptionId), (current) => {
            const subscription = current;
            if (!subscription ||
                subscription.inFlightPeriod !== periodIndex ||
                subscription.inFlightAttempt !== attempt) {
                return { op: 'noop', result: undefined };
            }
            return {
                op: 'set',
                value: clearRenewal(subscription),
                result: undefined,
            };
        });
    }
    async function clearActivationState(lookupKey, challengeId) {
        await store.update(activationKey(lookupKey), (current) => {
            const marker = current;
            if (marker?.challengeId !== challengeId)
                return { op: 'noop', result: undefined };
            return { op: 'delete', result: undefined };
        });
    }
    async function ownsActivation(lookupKey, challengeId) {
        const marker = (await store.get(activationKey(lookupKey)));
        return marker?.challengeId === challengeId;
    }
    return {
        async activate({ challengeId, create, isReusable, lookupKey }) {
            const claimed = await store.update(credentialKey(challengeId), (current) => {
                if (current)
                    return { op: 'noop', result: false };
                return {
                    op: 'set',
                    value: { claimedAt: timestamp() },
                    result: true,
                };
            });
            if (!claimed)
                return { status: 'replayed' };
            const existing = await getByLookupKey(lookupKey);
            if (existing && isReusable?.(existing)) {
                return { status: 'existing', subscription: existing };
            }
            const started = await store.update(activationKey(lookupKey), (current) => {
                const marker = current;
                if (marker && !isStaleActivation(marker, activationTimeoutMs)) {
                    return { op: 'noop', result: { status: 'inFlight' } };
                }
                return {
                    op: 'set',
                    value: {
                        challengeId,
                        startedAt: timestamp(),
                    },
                    result: { status: 'started' },
                };
            });
            if (started.status !== 'started')
                return { status: 'inFlight' };
            const claimedExisting = await getByLookupKey(lookupKey);
            if (claimedExisting && isReusable?.(claimedExisting)) {
                await clearActivationState(lookupKey, challengeId);
                return { status: 'existing', subscription: claimedExisting };
            }
            const result = await create().catch(async (error) => {
                await clearActivationState(lookupKey, challengeId);
                throw error;
            });
            const { subscription } = result;
            const committed = await store.update(activationKey(subscription.lookupKey), (current) => {
                const marker = current;
                if (marker?.challengeId !== challengeId)
                    return { op: 'noop', result: false };
                return {
                    op: 'set',
                    value: {
                        ...marker,
                        committingAt: timestamp(),
                        startedAt: timestamp(),
                    },
                    result: true,
                };
            });
            if (!committed) {
                await store.put(recordKey(subscription.subscriptionId), {
                    ...subscription,
                    canceledAt: subscription.canceledAt ?? timestamp(),
                });
                return { status: 'claimMismatch' };
            }
            const previous = await getByLookupKey(subscription.lookupKey);
            if (previous && previous.subscriptionId !== subscription.subscriptionId) {
                if (!(await ownsActivation(subscription.lookupKey, challengeId))) {
                    return { status: 'claimMismatch' };
                }
                await store.put(recordKey(previous.subscriptionId), {
                    ...previous,
                    canceledAt: previous.canceledAt ?? timestamp(),
                });
            }
            if (!(await ownsActivation(subscription.lookupKey, challengeId))) {
                return { status: 'claimMismatch' };
            }
            await store.put(recordKey(subscription.subscriptionId), subscription);
            if (!(await ownsActivation(subscription.lookupKey, challengeId))) {
                return { status: 'claimMismatch' };
            }
            await store.put(lookupRecordKey(subscription.lookupKey), subscription.subscriptionId);
            await clearActivationState(subscription.lookupKey, challengeId);
            return { status: 'activated', result };
        },
        async get(subscriptionId) {
            return (await store.get(recordKey(subscriptionId)));
        },
        async getAccessKey(key) {
            return (await store.get(accessKeyKey(key)));
        },
        async getAccessKeyByAddress(address) {
            return (await store.get(accessKeyAddressKey(address)));
        },
        async getByKey(key) {
            return getByLookupKey(key);
        },
        async getOrCreateAccessKey(key) {
            const existing = (await store.get(accessKeyKey(key)));
            if (existing)
                return existing;
            const privateKey = Secp256k1.randomPrivateKey();
            const account = TempoAccount.fromSecp256k1(privateKey);
            const candidate = {
                accessKeyAddress: account.address.toLowerCase(),
                keyType: account.keyType,
                privateKey,
            };
            return store
                .update(accessKeyKey(key), (current) => {
                if (current) {
                    return { op: 'noop', result: current };
                }
                return { op: 'set', value: candidate, result: candidate };
            })
                .then(async (record) => {
                await store.update(accessKeyAddressKey(record.accessKeyAddress), (current) => {
                    if (current)
                        return { op: 'noop', result: undefined };
                    return { op: 'set', value: record, result: undefined };
                });
                return record;
            });
        },
        async put(record) {
            await store.put(recordKey(record.subscriptionId), record);
            await store.put(lookupRecordKey(record.lookupKey), record.subscriptionId);
        },
        async renew({ inFlightReference, periodIndex, renew, subscriptionId }) {
            const attempt = createAttemptToken();
            const started = await store.update(recordKey(subscriptionId), (current) => {
                const subscription = current;
                if (!subscription)
                    return { op: 'noop', result: { status: 'missing' } };
                if (subscription.lastChargedPeriod >= periodIndex) {
                    return {
                        op: 'noop',
                        result: { status: 'charged', subscription },
                    };
                }
                if (subscription.inFlightPeriod !== undefined &&
                    !isStaleRenewal(subscription, renewalTimeoutMs)) {
                    return {
                        op: 'noop',
                        result: { status: 'inFlight', subscription },
                    };
                }
                const next = {
                    ...subscription,
                    inFlightAttempt: attempt,
                    inFlightPeriod: periodIndex,
                    inFlightReference,
                    inFlightStartedAt: timestamp(),
                };
                return {
                    op: 'set',
                    value: next,
                    result: { status: 'started', subscription: next },
                };
            });
            if (started.status !== 'started')
                return started;
            const active = await getByLookupKey(started.subscription.lookupKey);
            if (active?.subscriptionId !== subscriptionId) {
                await clearRenewalState(subscriptionId, periodIndex, attempt);
                return { status: 'superseded', subscription: started.subscription };
            }
            const result = await renew({
                inFlightReference,
                periodIndex,
                subscription: started.subscription,
            }).catch(async (error) => {
                await clearRenewalState(subscriptionId, periodIndex, attempt);
                throw error;
            });
            const activeAfterRenew = await getByLookupKey(result.subscription.lookupKey);
            if (activeAfterRenew?.subscriptionId !== subscriptionId) {
                await clearRenewalState(subscriptionId, periodIndex, attempt);
                return { status: 'superseded', subscription: started.subscription };
            }
            const committed = await store.update(recordKey(subscriptionId), (current) => {
                const existing = current;
                if (!existing ||
                    existing.inFlightPeriod !== periodIndex ||
                    existing.inFlightAttempt !== attempt) {
                    return { op: 'noop', result: false };
                }
                const terminal = {
                    ...(existing.canceledAt ? { canceledAt: existing.canceledAt } : {}),
                    ...(existing.revokedAt ? { revokedAt: existing.revokedAt } : {}),
                };
                return {
                    op: 'set',
                    value: clearRenewal({
                        ...result.subscription,
                        ...terminal,
                        lastChargedPeriod: periodIndex,
                        subscriptionId,
                    }),
                    result: true,
                };
            });
            if (!committed)
                return { status: 'claimMismatch' };
            const ownsLookup = await store.update(lookupRecordKey(result.subscription.lookupKey), (current) => {
                if (current !== subscriptionId)
                    return { op: 'noop', result: false };
                return { op: 'set', value: subscriptionId, result: true };
            });
            if (!ownsLookup)
                return { status: 'superseded', subscription: started.subscription };
            return { status: 'renewed', result };
        },
    };
}
function isStaleActivation(marker, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
        return false;
    if ('committingAt' in marker && marker.committingAt)
        return false;
    const startedAt = new Date(marker.startedAt ?? '').getTime();
    if (!Number.isFinite(startedAt))
        return true;
    return Date.now() - startedAt >= timeoutMs;
}
function isStaleRenewal(subscription, timeoutMs) {
    return isStaleActivation({ startedAt: subscription.inFlightStartedAt }, timeoutMs);
}
function clearRenewal(subscription) {
    return {
        ...subscription,
        inFlightAttempt: undefined,
        inFlightPeriod: undefined,
        inFlightReference: undefined,
        inFlightStartedAt: undefined,
    };
}
function timestamp() {
    return new Date().toISOString();
}
function createAttemptToken() {
    return globalThis.crypto.randomUUID();
}
//# sourceMappingURL=Store.js.map