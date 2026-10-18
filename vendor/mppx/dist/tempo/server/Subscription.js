import { Base64 } from 'ox';
import { KeyAuthorization } from 'ox/tempo';
import { encodeFunctionData, isAddressEqual, parseEventLogs, } from 'viem';
import { call as viem_call, prepareTransactionRequest, sendRawTransaction, sendRawTransactionSync, signTransaction, } from 'viem/actions';
import { Abis, Account as TempoAccount, Transaction } from 'viem/tempo';
import { tempo as tempo_chain } from 'viem/tempo/chains';
import { VerificationFailedError } from '../../Errors.js';
import * as Method from '../../Method.js';
import * as Store from '../../Store.js';
import * as ClientResolver from '../../viem/Client.js';
import * as Attribution from '../Attribution.js';
import * as Account from '../internal/account.js';
import * as defaults from '../internal/defaults.js';
import * as FeePayer from '../internal/fee-payer.js';
import * as Proof from '../internal/proof.js';
import * as Methods from '../Methods.js';
import { assertSubscriptionTiming, toSubscriptionPeriodSeconds, verifySubscriptionKeyAuthorization, } from '../subscription/KeyAuthorization.js';
import * as SubscriptionReceipt from '../subscription/Receipt.js';
import * as SubscriptionStore from '../subscription/Store.js';
/**
 * Creates a Tempo subscription method for recurring TIP-20 token payments.
 *
 * The method handles activation, request-path reuse, and optional lazy renewals.
 */
export function subscription(p) {
    const parameters = p;
    const rawStore = (parameters.store ?? Store.memory());
    if (typeof rawStore.update !== 'function') {
        throw new Error('tempo.subscription() requires an atomic store with `update`.');
    }
    const defaultChainId = parameters.chainId ?? defaults.chainId.testnet;
    const { amount, currency = defaults.resolveCurrency({ chainId: defaultChainId }), decimals = defaults.decimals, description, externalId, periodCount, periodUnit, subscriptionExpires, } = parameters;
    const { recipient } = Account.resolve(parameters);
    const context = createContext(parameters, {
        store: Store.from(rawStore, { keyPrefix: parameters.storeKeyPrefix }),
        options: {
            activationTimeoutMs: parameters.activationTimeoutMs,
            renewalTimeoutMs: parameters.renewalTimeoutMs,
        },
    });
    const { feePayer, feePayerPolicy, getClient, store, waitForConfirmation } = context;
    const method = Method.toServer(Methods.subscription, {
        canOffer: parameters.canOffer,
        onPaymentSuccess: parameters.onPaymentSuccess,
        defaults: {
            amount,
            currency,
            decimals,
            description,
            externalId,
            periodCount,
            periodUnit,
            recipient,
            subscriptionExpires,
        },
        extensions: {
            renew: (parameters) => renewWithContext({
                context: {
                    ...context,
                    feePayerPolicy: parameters.feePayerPolicy
                        ? resolveFeePayerPolicy(context.feePayerPolicy, parameters.feePayerPolicy)
                        : context.feePayerPolicy,
                    waitForConfirmation: parameters.waitForConfirmation ?? context.waitForConfirmation,
                },
                subscriptionId: parameters.subscriptionId,
            }),
        },
        async authorize({ input, request }) {
            if (parameters.requireCredential)
                return undefined;
            const resolved = await parameters.resolve({ input, request });
            if (!resolved)
                return undefined;
            const subscription = await store.getByKey(resolved.key);
            if (!subscription || !isActive(subscription))
                return undefined;
            if (!subscriptionMatchesRequest(subscription, request))
                return undefined;
            const periodIndex = getPeriodIndex(subscription);
            if (periodIndex > subscription.lastChargedPeriod) {
                const renew = resolveRenewalHandler({
                    feePayer,
                    feePayerPolicy,
                    getClient,
                    parameters,
                    store,
                    subscription,
                    waitForConfirmation,
                });
                if (!renew)
                    return undefined;
                const renewal = await settleRenewal({
                    expectedLookupKey: resolved.key,
                    periodIndex,
                    renew,
                    request,
                    store,
                    subscription,
                });
                if (!renewal)
                    return undefined;
                if (renewal.status === 'charged')
                    return { receipt: renewal.receipt };
                if (renewal.status === 'inFlight') {
                    return {
                        receipt: renewal.receipt,
                        response: new Response(null, {
                            headers: { 'Retry-After': '1' },
                            status: 409,
                        }),
                    };
                }
                await parameters.hooks?.renewed?.({
                    periodIndex,
                    receipt: renewal.result.receipt,
                    subscription: renewal.result.subscription,
                });
                return {
                    receipt: renewal.result.receipt,
                };
            }
            return {
                receipt: SubscriptionReceipt.fromRecord(subscription),
            };
        },
        async request({ capturedRequest, credential, request }) {
            const credentialRequest = credential?.challenge.request;
            const chainId = request.chainId ??
                parameters.chainId ??
                credentialRequest?.methodDetails?.chainId ??
                defaults.chainId.testnet;
            const parsedRequest = Methods.subscription.schema.request.parse({
                ...request,
                chainId,
            });
            const input = requestFromCaptured(capturedRequest);
            const resolved = await parameters.resolve({ input, request: parsedRequest });
            const existing = resolved ? await store.getByKey(resolved.key) : null;
            const accessKey = !credential
                ? resolved
                    ? await resolveChallengeAccessKey({
                        existing,
                        input,
                        parameters,
                        request: parsedRequest,
                        resolved,
                        store,
                    })
                    : parameters.requireCredential && !parameters.activate
                        ? await createUnboundChallengeAccessKey({ store })
                        : undefined
                : (credentialRequest?.methodDetails?.accessKey ?? parsedRequest.methodDetails?.accessKey);
            if (!accessKey) {
                throw new VerificationFailedError({ reason: 'subscription accessKey is missing' });
            }
            // Challenges carry the server-generated key in methodDetails so the shared request shape stays spec-compatible.
            return {
                ...request,
                methodDetails: {
                    ...request.methodDetails,
                    accessKey,
                },
                chainId,
            };
        },
        stableBinding: subscriptionBinding,
        async verify({ credential, envelope, request }) {
            const input = requestFromCaptured(envelope?.capturedRequest);
            const parsed = Methods.subscription.schema.request.safeParse(request);
            const parsedRequest = parsed.success ? parsed.data : request;
            assertSubscriptionTiming({
                challengeExpires: credential.challenge.expires,
                request: parsedRequest,
            });
            const challengeRequest = credential.challenge.request;
            let resolved = null;
            let accessKey = challengeRequest.methodDetails?.accessKey ?? parsedRequest.methodDetails?.accessKey;
            if (!accessKey) {
                resolved = await parameters.resolve({ input, request: parsedRequest });
                if (!resolved) {
                    throw new VerificationFailedError({ reason: 'subscription could not be resolved' });
                }
                accessKey = await resolveAccessKey({ input, parameters, request: parsedRequest, resolved });
            }
            if (!accessKey) {
                throw new VerificationFailedError({ reason: 'subscription accessKey is missing' });
            }
            const verified = verifySubscriptionKeyAuthorization({
                accessKey,
                challengeId: credential.challenge.id,
                chainId: parsedRequest.methodDetails?.chainId ?? defaults.chainId.testnet,
                payload: credential.payload,
                request: parsedRequest,
            });
            const declaredSource = credential.source ? Proof.parsePkhSource(credential.source) : null;
            if (declaredSource &&
                (declaredSource.chainId !== verified.source.chainId ||
                    !isAddressEqual(declaredSource.address, verified.source.address))) {
                throw new VerificationFailedError({
                    reason: 'credential source does not match signature',
                });
            }
            resolved =
                (await parameters.resolve({ input, request: parsedRequest, source: verified.source })) ??
                    resolved;
            if (!resolved) {
                throw new VerificationFailedError({ reason: 'subscription could not be resolved' });
            }
            const activation = await store.activate({
                challengeId: credential.challenge.id,
                isReusable: (subscription) => parameters.requireCredential
                    ? isActiveSubscriptionForRequest(subscription, parsedRequest)
                    : isReusableSubscription(subscription, parsedRequest),
                lookupKey: resolved.key,
                async create() {
                    const activation = withSubscriptionAccessKey(await activateSubscription({
                        accessKey,
                        auto: {
                            challengeId: credential.challenge.id,
                            feePayer,
                            feePayerPolicy,
                            getClient,
                            keyAuthorization: credential.payload.signature,
                            realm: credential.challenge.realm,
                            store,
                            waitForConfirmation,
                        },
                        credential: credential,
                        input,
                        parameters,
                        request: parsedRequest,
                        resolved,
                        source: verified.source,
                    }), accessKey);
                    validateSubscriptionSettlement(activation, {
                        expectedLookupKey: resolved.key,
                        expectedPeriodIndex: 0,
                        request: parsedRequest,
                    });
                    return activation;
                },
            });
            if (activation.status === 'replayed') {
                throw new VerificationFailedError({
                    reason: 'subscription credential has already been used',
                });
            }
            if (activation.status === 'inFlight') {
                throw new VerificationFailedError({
                    reason: 'subscription activation is already in flight',
                });
            }
            if (activation.status === 'claimMismatch') {
                throw new VerificationFailedError({ reason: 'subscription activation claim mismatch' });
            }
            if (activation.status === 'existing') {
                const subscription = activation.subscription;
                assertSubscriptionPayer(subscription, verified.source, {
                    required: parameters.requireCredential,
                });
                const periodIndex = getPeriodIndex(subscription);
                if (periodIndex > subscription.lastChargedPeriod) {
                    const renew = resolveRenewalHandler({
                        feePayer,
                        feePayerPolicy,
                        getClient,
                        parameters,
                        store,
                        subscription,
                        waitForConfirmation,
                    });
                    if (!renew) {
                        throw new VerificationFailedError({ reason: 'subscription renewal is required' });
                    }
                    const renewal = await settleRenewal({
                        expectedLookupKey: resolved.key,
                        periodIndex,
                        renew,
                        request: parsedRequest,
                        store,
                        subscription,
                    });
                    if (!renewal) {
                        throw new VerificationFailedError({ reason: 'subscription renewal failed' });
                    }
                    if (renewal.status === 'charged' || renewal.status === 'inFlight') {
                        return renewal.receipt;
                    }
                    await parameters.hooks?.renewed?.({
                        periodIndex,
                        receipt: renewal.result.receipt,
                        subscription: renewal.result.subscription,
                    });
                    return renewal.result.receipt;
                }
                return SubscriptionReceipt.fromRecord(subscription);
            }
            await parameters.hooks?.activated?.({
                receipt: activation.result.receipt,
                subscription: activation.result.subscription,
            });
            return activation.result.receipt;
        },
    });
    return method;
}
// Access-key provisioning can cost around 4M gas.
const defaultFeePayerPolicy = {
    maxGas: 5000000n,
    maxTotalFee: 200000000000000000n,
};
function resolveFeePayerPolicy(...policies) {
    return Object.assign({}, defaultFeePayerPolicy, ...policies);
}
function requestFromCaptured(capturedRequest) {
    if (!capturedRequest)
        return new Request('https://subscription.invalid');
    return new Request(capturedRequest.url, {
        headers: capturedRequest.headers,
        method: capturedRequest.method,
    });
}
async function resolveAccessKey(parameters) {
    const { input, parameters: subscriptionParameters, request, resolved } = parameters;
    return (resolved.accessKey ??
        (subscriptionParameters.accessKey
            ? await subscriptionParameters.accessKey({ input, request, resolved })
            : undefined));
}
async function resolveChallengeAccessKey(parameters) {
    const { existing, input, parameters: subscriptionParameters, request, resolved, store, } = parameters;
    if (!subscriptionParameters.activate) {
        // In automatic mode, the SDK owns the server access key so apps can issue
        // challenges from only their resolved subscription lookup key.
        const accessKey = await store.getOrCreateAccessKey(resolved.key);
        return {
            accessKeyAddress: accessKey.accessKeyAddress,
            keyType: accessKey.keyType,
        };
    }
    // Manual activation keeps the lower-level API: callers can provide the
    // access key for new challenges, while active subscriptions reuse the stored key.
    return ((await resolveAccessKey({ input, parameters: subscriptionParameters, request, resolved })) ??
        (existing && isActive(existing) ? existing.accessKey : undefined));
}
async function createUnboundChallengeAccessKey(parameters) {
    const accessKey = await parameters.store.getOrCreateAccessKey(`challenge:${createSubscriptionId()}`);
    return {
        accessKeyAddress: accessKey.accessKeyAddress,
        keyType: accessKey.keyType,
    };
}
async function activateSubscription(parameters) {
    const { accessKey, auto, credential, input, parameters: subscriptionParameters, request, resolved, source, } = parameters;
    if (subscriptionParameters.activate) {
        // A custom activate hook owns settlement and record creation.
        return subscriptionParameters.activate({
            accessKey,
            credential,
            input,
            request,
            resolved,
            source,
        });
    }
    if (!source) {
        throw new VerificationFailedError({ reason: 'subscription payer is missing' });
    }
    // Automatic activation bills the first period and persists the recurring
    // billing authority needed for request-path and background renewals.
    const reference = await submitSubscriptionPayment({
        accessKey,
        feePayer: auto.feePayer,
        feePayerPolicy: auto.feePayerPolicy,
        getClient: auto.getClient,
        keyAuthorization: auto.keyAuthorization,
        lookupKey: resolved.key,
        request,
        settlementReference: auto.challengeId,
        source,
        store: auto.store,
        waitForConfirmation: auto.waitForConfirmation,
    });
    const timestamp = new Date().toISOString();
    const subscription = {
        accessKey,
        amount: request.amount,
        billingAnchor: timestamp,
        chainId: request.methodDetails?.chainId,
        currency: request.currency,
        externalId: request.externalId,
        keyAuthorization: auto.keyAuthorization,
        lastChargedPeriod: 0,
        lookupKey: resolved.key,
        payer: source,
        periodCount: request.periodCount,
        periodUnit: request.periodUnit,
        recipient: request.recipient,
        reference,
        subscriptionExpires: request.subscriptionExpires,
        subscriptionId: createSubscriptionId(),
        timestamp,
    };
    return {
        receipt: SubscriptionReceipt.createSubscriptionReceipt(subscription),
        subscription,
    };
}
async function settleRenewal(parameters) {
    const { expectedLookupKey, periodIndex, renew, request, store, subscription } = parameters;
    const inFlightReference = renewalReference(subscription.subscriptionId, periodIndex);
    const renewal = await store.renew({
        inFlightReference,
        periodIndex,
        async renew({ inFlightReference, periodIndex, subscription: started }) {
            const renewed = withSubscriptionAccessKey(await renew({
                inFlightReference,
                periodIndex,
                subscription: started,
            }), started.accessKey);
            validateSubscriptionSettlement(renewed, {
                expectedLookupKey,
                expectedPeriodIndex: periodIndex,
                expectedSubscriptionId: subscription.subscriptionId,
                previous: started,
                request,
            });
            return renewed;
        },
        subscriptionId: subscription.subscriptionId,
    });
    if (renewal.status === 'charged') {
        return { receipt: SubscriptionReceipt.fromRecord(renewal.subscription), status: 'charged' };
    }
    if (renewal.status === 'inFlight') {
        return { receipt: SubscriptionReceipt.fromRecord(renewal.subscription), status: 'inFlight' };
    }
    if (renewal.status === 'renewed')
        return { result: renewal.result, status: 'renewed' };
    if (renewal.status === 'claimMismatch') {
        throw new VerificationFailedError({ reason: 'subscription renewal claim mismatch' });
    }
    return null;
}
function renewalReference(subscriptionId, periodIndex) {
    // This stable identifier is persisted before the billing hook runs so apps can
    // use it as an idempotency/reconciliation key if a renewal crashes mid-flight.
    return `renewal:${subscriptionId}:${periodIndex}`;
}
function withSubscriptionAccessKey(result, accessKey) {
    if (!accessKey || result.subscription.accessKey)
        return result;
    return {
        ...result,
        subscription: {
            ...result.subscription,
            accessKey,
        },
    };
}
function getPeriodIndex(subscription) {
    const anchor = new Date(subscription.billingAnchor).getTime();
    const expires = new Date(subscription.subscriptionExpires).getTime();
    const now = Date.now();
    if (!Number.isFinite(anchor) || !Number.isFinite(expires) || now >= expires) {
        return Number.POSITIVE_INFINITY;
    }
    let periodSeconds;
    try {
        periodSeconds = toSubscriptionPeriodSeconds(subscription);
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, Math.floor((now - anchor) / (periodSeconds * 1_000)));
}
function isActive(subscription) {
    if (subscription.canceledAt || subscription.revokedAt)
        return false;
    return new Date(subscription.subscriptionExpires).getTime() > Date.now();
}
function isActiveSubscriptionForRequest(subscription, request) {
    return isActive(subscription) && subscriptionMatchesRequest(subscription, request);
}
function isReusableSubscription(subscription, request) {
    return (isActiveSubscriptionForRequest(subscription, request) &&
        getPeriodIndex(subscription) <= subscription.lastChargedPeriod);
}
function subscriptionMatchesRequest(subscription, request) {
    const actual = comparableSubscriptionBinding(subscription);
    const expected = comparableSubscriptionBinding(request);
    return Object.keys(expected).every((key) => actual[key] === expected[key]);
}
function assertSubscriptionPayer(subscription, source, options) {
    if (!subscription.payer) {
        if (options?.required) {
            throw new VerificationFailedError({ reason: 'subscription payer is missing' });
        }
        return;
    }
    if (subscription.payer.chainId !== source.chainId ||
        !isAddressEqual(subscription.payer.address, source.address)) {
        throw new VerificationFailedError({ reason: 'subscription payer mismatch' });
    }
}
function comparableSubscriptionBinding(value) {
    const chainId = 'chainId' in value ? value.chainId : value.methodDetails?.chainId;
    return {
        amount: value.amount,
        chainId,
        currency: value.currency.toLowerCase(),
        externalId: value.externalId,
        periodCount: value.periodCount,
        periodUnit: value.periodUnit,
        recipient: value.recipient.toLowerCase(),
        subscriptionExpires: value.subscriptionExpires,
    };
}
function validateSubscriptionSettlement(result, options) {
    const { receipt, subscription } = result;
    assertSubscriptionReceipt(receipt, subscription);
    assertSubscriptionRecord(subscription, options);
    if (options.request) {
        assertSubscriptionRequestMatch(subscription, options.request);
    }
    else if (options.previous) {
        assertSubscriptionRequestMatch(subscription, options.previous);
    }
}
function assertSubscriptionReceipt(receipt, subscription) {
    if (receipt.method !== 'tempo' || receipt.status !== 'success') {
        throw new VerificationFailedError({ reason: 'subscription receipt is invalid' });
    }
    if (receipt.subscriptionId !== subscription.subscriptionId) {
        throw new VerificationFailedError({ reason: 'subscription receipt id mismatch' });
    }
    if (receipt.reference !== subscription.reference) {
        throw new VerificationFailedError({ reason: 'subscription receipt reference mismatch' });
    }
    if (receipt.timestamp !== subscription.timestamp) {
        throw new VerificationFailedError({ reason: 'subscription receipt timestamp mismatch' });
    }
    assertTransactionHash(receipt.reference, 'subscription reference must be a transaction hash');
    assertValidDate(receipt.timestamp, 'subscription receipt timestamp is invalid');
}
function assertSubscriptionRecord(subscription, options) {
    assertBase64Url(subscription.subscriptionId, 'subscriptionId must be base64url');
    assertTransactionHash(subscription.reference, 'subscription reference must be a transaction hash');
    const billingAnchor = assertValidDate(subscription.billingAnchor, 'subscription billingAnchor is invalid');
    const subscriptionExpires = assertValidDate(subscription.subscriptionExpires, 'subscriptionExpires is invalid');
    assertEqual(subscription.lookupKey, options.expectedLookupKey, {
        reason: 'subscription lookupKey does not match the resolved key',
    });
    assertEqual(subscription.lastChargedPeriod, options.expectedPeriodIndex, {
        reason: 'subscription lastChargedPeriod does not match the settled period',
    });
    if (options.expectedSubscriptionId) {
        assertEqual(subscription.subscriptionId, options.expectedSubscriptionId, {
            reason: 'subscriptionId does not match the active subscription',
        });
    }
    if (billingAnchor >= subscriptionExpires) {
        throw new VerificationFailedError({
            reason: 'subscription billingAnchor must be before subscriptionExpires',
        });
    }
}
function assertSubscriptionRequestMatch(subscription, request) {
    if (!subscriptionMatchesRequest(subscription, request)) {
        throw new VerificationFailedError({ reason: 'subscription record does not match request' });
    }
}
function assertBase64Url(value, reason) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new VerificationFailedError({ reason });
    }
}
function assertTransactionHash(value, reason) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new VerificationFailedError({ reason });
    }
}
function assertValidDate(value, reason) {
    const milliseconds = new Date(value).getTime();
    if (!Number.isFinite(milliseconds)) {
        throw new VerificationFailedError({ reason });
    }
    return milliseconds;
}
function assertEqual(actual, expected, options) {
    if (actual !== expected) {
        throw new VerificationFailedError(options);
    }
}
function subscriptionBinding(request) {
    return {
        amount: request.amount,
        chainId: request.methodDetails?.chainId,
        currency: request.currency,
        externalId: request.externalId,
        periodCount: request.periodCount,
        periodUnit: request.periodUnit,
        recipient: request.recipient,
        subscriptionExpires: request.subscriptionExpires,
    };
}
function resolveRenewalHandler(parameters) {
    const { feePayer, feePayerPolicy, getClient, parameters: subscriptionParameters, store, subscription, waitForConfirmation, } = parameters;
    if (subscriptionParameters.renew)
        return subscriptionParameters.renew;
    if (!subscription.accessKey || !subscription.payer)
        return undefined;
    return async ({ inFlightReference, periodIndex, subscription }) => {
        const reference = await submitSubscriptionPayment({
            accessKey: subscription.accessKey,
            feePayer,
            feePayerPolicy,
            getClient,
            lookupKey: subscription.lookupKey,
            request: subscription,
            settlementReference: inFlightReference,
            source: subscription.payer,
            store,
            waitForConfirmation,
        });
        const record = {
            ...subscription,
            lastChargedPeriod: periodIndex,
            reference,
            timestamp: new Date().toISOString(),
        };
        return {
            receipt: SubscriptionReceipt.createSubscriptionReceipt(record),
            subscription: record,
        };
    };
}
async function submitSubscriptionPayment(parameters) {
    const { accessKey, feePayer, feePayerPolicy, getClient, keyAuthorization, lookupKey, request, settlementReference, source, store, waitForConfirmation, } = parameters;
    const stored = (await store.getAccessKey(lookupKey)) ??
        (await store.getAccessKeyByAddress(accessKey.accessKeyAddress));
    if (!stored) {
        throw new VerificationFailedError({ reason: 'subscription access key is missing' });
    }
    const rawAccessAccount = TempoAccount.fromSecp256k1(stored.privateKey);
    if (!isAddressEqual(rawAccessAccount.address, accessKey.accessKeyAddress)) {
        throw new VerificationFailedError({
            reason: 'subscription access key does not match stored key',
        });
    }
    const chainId = request.methodDetails?.chainId ?? source.chainId;
    const client = await getClient({ chainId });
    const account = TempoAccount.fromSecp256k1(stored.privateKey, {
        access: source.address,
    });
    const memo = Attribution.encode({
        challengeId: settlementReference,
        serverId: lookupKey,
    });
    const baseTransaction = {
        account,
        calls: [
            {
                data: encodeFunctionData({
                    abi: Abis.tip20,
                    functionName: 'transferWithMemo',
                    args: [request.recipient, BigInt(request.amount), memo],
                }),
                to: request.currency,
            },
        ],
        chainId,
        ...(keyAuthorization
            ? { keyAuthorization: KeyAuthorization.deserialize(keyAuthorization) }
            : {}),
    };
    const serializedTransaction = await (async () => {
        if (!feePayer)
            return await signTransaction(client, baseTransaction);
        // For sponsored payments, prepare the tx via `prepareTransactionRequest`
        // (without `feePayer: true`) so viem returns the chain's full
        // proof-inclusive gas estimate. With `feePayer: true` viem sets a
        // dummy sig + null feePayerSignature, dropping signature and key
        // authorization verification costs -- see chainConfig.js FIXME. We add
        // a small buffer for fee-payer overhead, then flip `feePayer = true`
        // and re-sign with the fee-payer-sponsored envelope.
        const prepared = await prepareTransactionRequest(client, {
            ...baseTransaction,
            nonceKey: 'expiring',
        });
        prepared.gas = (prepared.gas ?? 0n) + 5000n;
        prepared.feePayer = true;
        const userSerialized = await signTransaction(client, prepared);
        const userTransaction = Transaction.deserialize(userSerialized);
        const completed = await FeePayer.preflightSponsorship({
            transaction: userTransaction,
            simulate: (request) => viem_call(client, request),
            async complete() {
                const sponsored = FeePayer.prepareSponsoredTransaction({
                    account: feePayer,
                    chainId: chainId ?? client.chain.id,
                    details: {
                        amount: String(request.amount),
                        currency: String(request.currency),
                        recipient: String(request.recipient),
                    },
                    ...(feePayerPolicy ? { policy: feePayerPolicy } : {}),
                    transaction: userTransaction,
                });
                return { feePayer: feePayer.address, transaction: sponsored };
            },
        });
        return await signTransaction(client, completed.transaction);
    })();
    const transaction = Transaction.deserialize(serializedTransaction);
    if (!feePayer)
        await viem_call(client, {
            ...transaction,
            account: transaction.from,
            calls: transaction.calls,
            feePayerSignature: undefined,
        });
    if (!waitForConfirmation) {
        // Optimistic mode has no receipt to inspect, so it cannot detect a T6
        // (TIP-1028) held transfer. Use `waitForConfirmation: true` for T6-safe proof.
        return sendRawTransaction(client, {
            serializedTransaction: serializedTransaction,
        });
    }
    const receipt = await sendRawTransactionSync(client, {
        serializedTransaction: serializedTransaction,
    });
    if (receipt.status !== 'success') {
        throw new VerificationFailedError({
            reason: `subscription transaction reverted: ${receipt.transactionHash}`,
        });
    }
    assertSubscriptionTransfer(receipt, {
        amount: BigInt(request.amount),
        currency: request.currency,
        memo,
        recipient: request.recipient,
    });
    return receipt.transactionHash;
}
/**
 * Asserts a confirmed subscription payment credited the recipient.
 *
 * Transaction success alone is not proof: under Tempo T6 (TIP-1028) a recipient
 * receive policy can hold the funds in `ReceivePolicyGuard` while the tx still
 * succeeds. Settlement always emits one `transferWithMemo(recipient, amount,
 * memo)`, so this requires a matching `TransferWithMemo` log on the expected
 * token. A held transfer fails because its `to` is the guard, and the memo
 * binding excludes unrelated transfer effects in the same receipt.
 */
function assertSubscriptionTransfer(receipt, parameters) {
    const { amount, currency, memo, recipient } = parameters;
    const credited = parseEventLogs({
        abi: Abis.tip20,
        eventName: 'TransferWithMemo',
        logs: receipt.logs,
    }).some((log) => isAddressEqual(log.address, currency) &&
        isAddressEqual(log.args.to, recipient) &&
        log.args.amount === amount &&
        log.args.memo.toLowerCase() === memo.toLowerCase());
    if (!credited) {
        throw new VerificationFailedError({
            reason: `subscription transfer was not credited to the recipient ` +
                `(funds may have been held by a receive policy): ${receipt.transactionHash}`,
        });
    }
}
function createSubscriptionId() {
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Base64.fromBytes(bytes, { url: true }).replace(/=+$/, '');
}
/**
 * Renews an overdue subscription outside of the HTTP request path.
 * Intended for cron jobs or background workers that bill subscriptions on a schedule.
 *
 * Returns the renewal result if the subscription was overdue, or `null` if already current.
 */
export async function renew(parameters) {
    const context = createContext(parameters, {
        store: parameters.store,
        options: {
            renewalTimeoutMs: parameters.renewalTimeoutMs,
        },
    });
    return renewWithContext({
        context,
        subscriptionId: parameters.subscriptionId,
    });
}
async function renewWithContext(parameters) {
    const { context, subscriptionId } = parameters;
    const record = await context.store.get(subscriptionId);
    if (!record)
        return null;
    if (!isActive(record))
        return null;
    const active = await context.store.getByKey(record.lookupKey);
    if (active?.subscriptionId !== record.subscriptionId)
        return null;
    const periodIndex = getPeriodIndex(record);
    if (periodIndex <= record.lastChargedPeriod)
        return null;
    const renew = resolveRenewalHandler({
        feePayer: context.feePayer,
        feePayerPolicy: context.feePayerPolicy,
        getClient: context.getClient,
        parameters: context.parameters,
        store: context.store,
        subscription: record,
        waitForConfirmation: context.waitForConfirmation,
    });
    if (!renew)
        return null;
    const renewal = await settleRenewal({
        expectedLookupKey: record.lookupKey,
        periodIndex,
        renew,
        store: context.store,
        subscription: record,
    });
    if (renewal?.status !== 'renewed')
        return null;
    await context.parameters.hooks?.renewed?.({
        periodIndex,
        receipt: renewal.result.receipt,
        subscription: renewal.result.subscription,
    });
    return renewal.result;
}
function createContext(parameters, options) {
    const { feePayer } = Account.resolve(parameters);
    const store = SubscriptionStore.fromStore(options.store, options.options);
    const getClient = ClientResolver.getResolver({
        chain: tempo_chain,
        getClient: parameters.getClient,
        rpcUrl: defaults.rpcUrl,
    });
    return {
        feePayer,
        feePayerPolicy: resolveFeePayerPolicy(parameters.feePayerPolicy),
        getClient,
        parameters,
        store,
        waitForConfirmation: parameters.waitForConfirmation ?? true,
    };
}
//# sourceMappingURL=Subscription.js.map