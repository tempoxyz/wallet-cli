import * as SignatureEnvelope from 'ox/tempo/SignatureEnvelope';
import { decodeFunctionData, formatUnits, keccak256, parseEventLogs, } from 'viem';
import { getTransactionReceipt, sendRawTransaction, sendRawTransactionSync, signTransaction, verifyTypedData, call as viem_call, } from 'viem/actions';
import { Abis, Actions, Transaction } from 'viem/tempo';
import { tempo as tempo_chain } from 'viem/tempo/chains';
import { PaymentError, VerificationFailedError } from '../../Errors.js';
import * as Expires from '../../Expires.js';
import * as Method from '../../Method.js';
import * as Store from '../../Store.js';
import * as Client from '../../viem/Client.js';
import * as Attribution from '../Attribution.js';
import * as Account from '../internal/account.js';
import * as TempoAddress from '../internal/address.js';
import * as Charge_internal from '../internal/charge.js';
import * as defaults from '../internal/defaults.js';
import * as FeePayer from '../internal/fee-payer.js';
import { resolveFeeToken } from '../internal/fee-token.js';
import * as MachineTokenCharge from '../internal/machine-token-charge.js';
import * as Proof from '../internal/proof.js';
import * as Selectors from '../internal/selectors.js';
import * as Methods from '../Methods.js';
import { html as htmlContent } from './internal/html.gen.js';
import * as Relay from './Relay.js';
import * as SponsorBudget from './SponsorBudget.js';
/**
 * Creates a Tempo charge method intent for usage on the server.
 *
 * @example
 * ```ts
 * import { tempo } from 'mppx/server'
 *
 * const charge = tempo.charge()
 * ```
 */
export function charge(parameters = {}) {
    const { machineTokenEnabled, allowedFeeTokens: configuredAllowedFeeTokens, amount, currency = defaults.resolveCurrency(parameters), decimals = defaults.decimals, description, externalId, feeToken: configuredFeeToken, feePayerPolicy, html, relay, sponsorBudget, splits, supportedModes, validateSender, waitForConfirmation = true, } = parameters;
    if (configuredAllowedFeeTokens?.length === 0)
        throw new Error('`allowedFeeTokens` must contain at least one token.');
    const storeKeyPrefix = parameters.storeKeyPrefix ?? '';
    const rawStore = (parameters.store ?? Store.memory());
    const store = Store.from(rawStore, { keyPrefix: storeKeyPrefix });
    const { maxInFlightReservations: legacyMaxInFlightReservations, maxInFlightTotalFee: legacyMaxInFlightTotalFee, ...transactionFeePayerPolicy } = feePayerPolicy ?? {};
    const sponsorBudgetConfig = sponsorBudget === false ? undefined : (sponsorBudget ?? {});
    const maxInFlightReservations = sponsorBudgetConfig?.maxInFlightReservations ?? legacyMaxInFlightReservations ?? 100;
    const maxInFlightTotalFee = sponsorBudgetConfig?.maxInFlightTotalFee ??
        legacyMaxInFlightTotalFee ??
        (feePayerPolicy?.maxTotalFee ?? 50000000000000000n) * 10n;
    if (sponsorBudgetConfig) {
        if (!Number.isSafeInteger(maxInFlightReservations) || maxInFlightReservations <= 0)
            throw new Error('`sponsorBudget.maxInFlightReservations` must be a positive safe integer.');
        if (maxInFlightTotalFee <= 0n)
            throw new Error('`sponsorBudget.maxInFlightTotalFee` must be greater than zero.');
    }
    // Aggregate exposure belongs to the actual sponsor, not a caller-specific replay namespace.
    // Keep it unprefixed and shared across every tenant/process using the sponsor.
    const sponsorBudgetStore = sponsorBudgetConfig
        ? Store.from(sponsorBudgetConfig.store ?? rawStore)
        : undefined;
    const proofStore = parameters.store
        ? Store.from(parameters.store, {
            keyPrefix: storeKeyPrefix,
        })
        : undefined;
    const { recipient, feePayer, remoteFeePayer } = Account.resolve(parameters);
    if (configuredFeeToken && remoteFeePayer)
        throw new Error('`feeToken` can only be configured for a local fee payer.');
    const getClient = Client.getResolver({
        chain: { ...tempo_chain, experimental_preconfirmationTime: 500 },
        remoteFeePayer,
        getClient: parameters.getClient,
        rpcUrl: defaults.rpcUrl,
    });
    function resolveRequest(request) {
        const parsed = Methods.charge.schema.request.safeParse(request);
        if (parsed.success)
            return parsed.data;
        // Credential handlers receive the HMAC-bound request in canonical output
        // form, so it must not be transformed a second time.
        return request;
    }
    async function resolveCredentialContext({ credential, request, }) {
        const { challenge, payload } = credential;
        const resolvedRequest = resolveRequest(request);
        const chainId = resolvedRequest.methodDetails?.chainId ?? request.chainId;
        const { amount, methodDetails } = resolvedRequest;
        const supportedModes = methodDetails?.supportedModes;
        const currency = resolvedRequest.currency;
        const recipient = resolvedRequest.recipient;
        const machineTokenEnabled = methodDetails?.machineTokenEnabled === true;
        const settlementSender = machineTokenEnabled
            ? MachineTokenCharge.getSettlementSender(chainId)
            : undefined;
        const isZeroAmount = BigInt(amount) === 0n;
        Expires.assert(challenge.expires, challenge.id);
        if (isZeroAmount && payload.type !== 'proof')
            throw new MismatchError('Zero-amount challenges require a proof credential.', {});
        // Request-level local sponsorship takes precedence over the hosted provider.
        const localFeePayer = Account.is(request.feePayer) ? request.feePayer : feePayer;
        const allowedFeeTokens = configuredAllowedFeeTokens ??
            (localFeePayer || !remoteFeePayer ? FeePayer.defaultAllowedFeeTokens(chainId) : undefined);
        return {
            allowedFeeTokens,
            amount,
            machineTokenEnabled,
            chainId,
            challenge,
            client: await getClient({ chainId }),
            currency,
            isZeroAmount,
            methodDetails,
            payload,
            recipient,
            requestAllowsFeePayer: request.feePayer !== false,
            resolvedRequest,
            settlementSenders: settlementSender ? [settlementSender] : [],
            supportedModes,
        };
    }
    async function validateHashCredential(credential, payload, context) {
        const { amount, chainId, challenge, client, currency, methodDetails, recipient, settlementSenders, supportedModes, } = context;
        if (supportedModes && !supportedModes.includes('push'))
            throw new MismatchError('Hash credentials are not supported for this challenge.', {});
        const source = parseHashCredentialSource({
            chainId: chainId ?? client.chain?.id,
            source: credential.source,
        });
        const transfers = getExpectedTransfers({ amount, methodDetails, recipient });
        const receipt = await getTransactionReceipt(client, {
            hash: payload.hash,
        });
        const sender = source?.address ?? receipt.from;
        const matchedLogs = await assertTransferLogs(receipt, {
            currency,
            sender,
            settlementSenders,
            source,
            transfers,
            validateSender,
        });
        assertChallengeBoundMemo(matchedLogs, {
            challengeId: challenge.id,
            realm: challenge.realm,
        });
        return { receipt: toReceipt(receipt), sender, transfers };
    }
    async function validateProofCredential(credential, payload, context) {
        const { chainId, challenge, client, isZeroAmount } = context;
        if (!isZeroAmount)
            throw new MismatchError('Proof credentials are only valid for zero-amount challenges.', {});
        const expectedSource = credential.source;
        if (!expectedSource)
            throw new MismatchError('Proof credential must include a source.', {});
        const resolvedChainId = challenge.request.methodDetails?.chainId ?? chainId;
        const source = Proof.parsePkhSource(expectedSource);
        if (!source || source.chainId !== resolvedChainId)
            throw new MismatchError('Proof credential source is invalid.', {});
        const valid = await verifyTypedData(client, {
            address: source.address,
            ...Proof.typedData({
                account: source.address,
                chainId: resolvedChainId,
                challengeId: challenge.id,
                realm: challenge.realm,
            }),
            signature: payload.signature,
        });
        if (!valid) {
            const proofSigner = recoverAuthorizedProofSigner({
                chainId: resolvedChainId,
                challengeId: challenge.id,
                realm: challenge.realm,
                signature: payload.signature,
                sourceAddress: source.address,
            });
            const authorized = proofSigner
                ? await isActiveAccessKey(client, { accessKey: proofSigner, account: source.address })
                : false;
            if (!authorized)
                throw new MismatchError('Proof signature does not match source.', {});
        }
        return { sender: source.address };
    }
    async function validateTransactionCredential(credential, payload, request, context) {
        const { machineTokenEnabled, amount, chainId, challenge, client, currency, methodDetails, recipient, requestAllowsFeePayer, supportedModes, } = context;
        if (supportedModes && !supportedModes.includes('pull'))
            throw new MismatchError('Transaction credentials are not supported for this challenge.', {});
        const serializedTransaction = payload.signature;
        if (!FeePayer.isTempoTransaction(serializedTransaction))
            throw new MismatchError('Only Tempo (0x76/0x78) transactions are supported.', {});
        const transaction = Transaction.deserialize(serializedTransaction);
        if (!transaction.signature || !transaction.from)
            throw new MismatchError('Transaction must be signed by the sender before fee payer co-signing.', {});
        const isFeePayerTx = methodDetails?.feePayer === true &&
            requestAllowsFeePayer &&
            !!(Account.is(request.feePayer) ? request.feePayer : feePayer || remoteFeePayer);
        const transfers = getExpectedTransfers({ amount, methodDetails, recipient });
        const machineTokenRoute = machineTokenEnabled
            ? MachineTokenCharge.matchRoute({
                calls: transaction.calls ?? [],
                chainId: chainId ?? client.chain?.id,
                currency,
                transfers,
            })
            : undefined;
        const matchedCalls = machineTokenRoute?.transfers ??
            assertTransferCalls(transaction.calls ?? [], {
                currency,
                exactCount: isFeePayerTx,
                transfers,
            });
        assertChallengeBoundCallMemo(matchedCalls, {
            challengeId: challenge.id,
            realm: challenge.realm,
        });
        if (isFeePayerTx) {
            if (!machineTokenRoute)
                FeePayer.validateCalls(transaction.calls, { amount, currency, recipient }, { currency, expectedTransfers: transfers });
            FeePayer.assertAllowedFeeToken(transaction, context.allowedFeeTokens);
        }
        else {
            await viem_call(client, FeePayer.simulationTransaction(transaction, { feePayer: false }));
        }
        return {
            isFeePayerTx,
            serializedTransaction,
            settlementSenders: machineTokenRoute ? [machineTokenRoute.settlementSender] : [],
            transaction,
            transfers,
        };
    }
    async function validateCredential(credential, request, context) {
        switch (context.payload.type) {
            case 'hash': {
                const { receipt, sender, transfers } = await validateHashCredential(credential, context.payload, context);
                return {
                    details: { mode: 'push', sender, transfers },
                    hash: context.payload.hash,
                    receipt,
                    type: 'hash',
                };
            }
            case 'proof': {
                const { sender } = await validateProofCredential(credential, context.payload, context);
                return { details: { mode: 'proof', sender }, type: 'proof' };
            }
            case 'transaction': {
                const { isFeePayerTx, serializedTransaction, settlementSenders, transaction, transfers } = await validateTransactionCredential(credential, context.payload, request, context);
                return {
                    details: {
                        mode: 'pull',
                        sender: transaction.from,
                        serializedTransaction,
                        transfers,
                    },
                    isFeePayerTx,
                    serializedTransaction,
                    settlementSenders,
                    transaction,
                    transfers,
                    type: 'transaction',
                };
            }
        }
    }
    const method = Method.toServer(Methods.charge, {
        canOffer: parameters.canOffer,
        onPaymentSuccess: parameters.onPaymentSuccess,
        defaults: {
            machineTokenEnabled,
            amount,
            currency,
            decimals,
            description,
            externalId,
            recipient,
            splits,
            supportedModes,
        },
        stableBinding: chargeBinding,
        html: html
            ? {
                config: {},
                content: htmlContent,
                formatAmount: async (request) => {
                    try {
                        const chainId = request.methodDetails?.chainId;
                        if (chainId === undefined)
                            throw new Error('no chainId');
                        const client = await getClient({ chainId });
                        const metadata = await Actions.token.getMetadata(client, {
                            token: request.currency,
                        });
                        const symbol = new Intl.NumberFormat('en', {
                            style: 'currency',
                            currency: metadata.currency,
                            currencyDisplay: 'narrowSymbol',
                        })
                            .formatToParts(0)
                            .find((p) => p.type === 'currency')?.value ?? metadata.currency;
                        return `${symbol}${formatUnits(BigInt(request.amount), metadata.decimals)}`;
                    }
                    catch {
                        return `$${request.amount}`;
                    }
                },
                text: typeof html === 'object' ? html.text : undefined,
                theme: typeof html === 'object' ? html.theme : undefined,
            }
            : undefined,
        // TODO: dedupe `{charge,session}.request`
        async request({ credential, request }) {
            const chainId = await (async () => {
                if (request.chainId)
                    return request.chainId;
                if (parameters.chainId !== undefined)
                    return parameters.chainId;
                if (parameters.testnet)
                    return defaults.chainId.testnet;
                return (await getClient({})).chain?.id;
            })();
            const client = await (async () => {
                try {
                    return await getClient({ chainId });
                }
                catch {
                    throw new Error(`No client configured with chainId ${chainId}.`);
                }
            })();
            if (client.chain?.id !== chainId)
                throw new Error(`Client not configured with chainId ${chainId}.`);
            if (MachineTokenCharge.isMachineToken({
                chainId,
                currency: request.currency,
            }))
                throw new Error('MACH cannot be advertised as a charge currency. Advertise the settlement currency with `machineTokenEnabled: true`.');
            if (request.machineTokenEnabled && !MachineTokenCharge.isSupported(chainId))
                throw new Error(`Machine tokens are not supported on chainId ${chainId}.`);
            const resolvedFeePayer = (() => {
                if (request.feePayer === false)
                    return credential ? false : undefined;
                const account = Account.is(request.feePayer) ? request.feePayer : feePayer;
                if (credential)
                    return account ?? (remoteFeePayer ? true : undefined);
                return account || remoteFeePayer ? true : undefined;
            })();
            return {
                ...request,
                machineTokenEnabled: request.machineTokenEnabled || undefined,
                chainId,
                feePayer: resolvedFeePayer,
            };
        },
        async validate({ credential, request }) {
            const context = await resolveCredentialContext({ credential, request });
            const validated = await validateCredential(credential, request, context);
            return {
                challenge: context.challenge,
                credential,
                details: validated.details,
                intent: 'charge',
                method: 'tempo',
                request: context.resolvedRequest,
                source: credential.source,
            };
        },
        async broadcast({ credential, request }) {
            const context = await resolveCredentialContext({ credential, request });
            const { amount, chainId, challenge, client, currency, methodDetails, recipient, requestAllowsFeePayer, } = context;
            const validated = await validateCredential(credential, request, context);
            const feePayerAccount = methodDetails?.feePayer === true && requestAllowsFeePayer
                ? Account.is(request.feePayer)
                    ? request.feePayer
                    : feePayer
                : undefined;
            const expires = challenge.expires;
            Expires.assert(expires, challenge.id);
            const replayExpires = Date.parse(expires);
            switch (validated.type) {
                case 'hash': {
                    const { hash, receipt } = validated;
                    if (!(await tryClaimHash(store, hash, replayExpires))) {
                        throw new VerificationFailedError({
                            reason: 'Transaction hash has already been used',
                        });
                    }
                    return receipt;
                }
                case 'proof': {
                    if (proofStore && !(await tryClaimProof(proofStore, challenge.id, replayExpires))) {
                        throw new VerificationFailedError({
                            reason: 'Proof credential has already been used',
                        });
                    }
                    return {
                        method: 'tempo',
                        status: 'success',
                        timestamp: new Date().toISOString(),
                        reference: challenge.id,
                    };
                }
                case 'transaction': {
                    const { isFeePayerTx, serializedTransaction, settlementSenders, transaction, transfers } = validated;
                    // Pre-broadcast dedup: catch exact byte-for-byte replays early.
                    const hash = keccak256(serializedTransaction);
                    if (!(await tryClaimHash(store, hash, replayExpires))) {
                        throw new VerificationFailedError({
                            reason: 'Transaction hash has already been used',
                        });
                    }
                    let broadcastAttempted = false;
                    let finalHash;
                    let reservation;
                    try {
                        const { allowedFeeTokens } = context;
                        const completedTransaction = await (async () => {
                            if (feePayerAccount && methodDetails?.feePayer !== false) {
                                const selectableFeeTokens = allowedFeeTokens ?? FeePayer.defaultAllowedFeeTokens(chainId);
                                const completed = await FeePayer.preflightSponsorship({
                                    transaction,
                                    simulate: (request) => viem_call(client, request),
                                    async complete() {
                                        const feeToken = configuredFeeToken ??
                                            (await resolveFeeToken({
                                                account: feePayerAccount.address,
                                                allowedTokens: selectableFeeTokens,
                                                candidateTokens: selectableFeeTokens,
                                                client,
                                                prioritizeCandidates: true,
                                            }));
                                        const sponsored = FeePayer.prepareSponsoredTransaction({
                                            account: feePayerAccount,
                                            allowedFeeTokens: selectableFeeTokens,
                                            challengeExpires: expires,
                                            chainId: chainId ?? client.chain.id,
                                            details: { amount, currency, recipient },
                                            policy: transactionFeePayerPolicy,
                                            transaction: {
                                                ...transaction,
                                                ...(feeToken ? { feeToken } : {}),
                                            },
                                        });
                                        return { feePayer: feePayerAccount.address, transaction: sponsored };
                                    },
                                });
                                return {
                                    serializedTransaction: await signTransaction(client, completed.transaction),
                                    sponsor: completed.feePayer,
                                };
                            }
                            if (remoteFeePayer && isFeePayerTx) {
                                const completed = await FeePayer.preflightSponsorship({
                                    transaction,
                                    simulate: (request) => viem_call(client, request),
                                    async complete() {
                                        const hosted = await FeePayer.fillHostedFeePayerTransaction({
                                            allowedFeeTokens,
                                            challengeExpires: expires,
                                            chainId: chainId ?? client.chain.id,
                                            details: { amount, currency, recipient },
                                            policy: transactionFeePayerPolicy,
                                            request: (args) => client.request(args),
                                            transaction,
                                        });
                                        return { ...hosted, transaction };
                                    },
                                });
                                return {
                                    serializedTransaction: completed.serializedTransaction,
                                    sponsor: completed.feePayer,
                                };
                            }
                            return { serializedTransaction, sponsor: undefined };
                        })();
                        // Nodes normalize accepted signature encodings before deriving transaction hashes.
                        // Broadcast the same canonical envelope so replay keys match the node reference.
                        const serializedTransaction_final = await Transaction.serialize(Transaction.deserialize(completedTransaction.serializedTransaction));
                        finalHash = keccak256(serializedTransaction_final);
                        if (finalHash.toLowerCase() !== hash.toLowerCase() &&
                            !(await tryClaimHash(store, finalHash, replayExpires)))
                            throw new VerificationFailedError({
                                reason: 'Transaction hash has already been used',
                            });
                        if (isFeePayerTx) {
                            const sponsor = completedTransaction.sponsor;
                            if (!sponsor)
                                throw new VerificationFailedError({
                                    reason: 'Sponsored transaction has no configured fee payer',
                                });
                            const reservationChainId = chainId ?? client.chain.id;
                            const { totalFee, validBeforeValue } = FeePayer.assertTransactionPolicy({
                                challengeExpires: expires,
                                chainId: reservationChainId,
                                details: { amount, currency, recipient },
                                policy: transactionFeePayerPolicy,
                                transaction,
                            });
                            const expiresAt = validBeforeValue * 1_000;
                            const waitUntil = Math.min(expiresAt, expires ? Date.parse(expires) : Number.MAX_SAFE_INTEGER);
                            if (sponsorBudgetStore)
                                reservation = await SponsorBudget.reserve(sponsorBudgetStore, {
                                    chainId: reservationChainId,
                                    expiresAt,
                                    fee: totalFee,
                                    getReceipt: (transactionHash) => getTransactionReceipt(client, { hash: transactionHash }),
                                    id: finalHash.toLowerCase(),
                                    maxReservations: maxInFlightReservations,
                                    maxTotalFee: maxInFlightTotalFee,
                                    owner: globalThis.crypto.randomUUID(),
                                    sponsor,
                                    transactionHash: finalHash,
                                    waitUntil,
                                });
                            Expires.assert(challenge.expires, challenge.id);
                        }
                        // Pre-broadcast simulation for non-sponsored transactions.
                        if (!isFeePayerTx)
                            await viem_call(client, FeePayer.simulationTransaction(transaction, { feePayer: false }));
                        if (reservation &&
                            !(await SponsorBudget.transition(sponsorBudgetStore, reservation, 'broadcasting')))
                            throw new VerificationFailedError({
                                reason: 'Sponsor budget reservation ownership was lost before broadcast',
                            });
                        broadcastAttempted = true;
                        if (waitForConfirmation) {
                            const receipt = await sendRawTransactionSync(client, {
                                serializedTransaction: serializedTransaction_final,
                            });
                            if (reservation)
                                await SponsorBudget.release(sponsorBudgetStore, reservation);
                            const matchedLogs = await assertTransferLogs(receipt, {
                                currency,
                                sender: transaction.from,
                                settlementSenders,
                                transfers,
                            });
                            assertChallengeBoundMemo(matchedLogs, {
                                challengeId: challenge.id,
                                realm: challenge.realm,
                            });
                            if (receipt.transactionHash.toLowerCase() !== finalHash.toLowerCase())
                                throw new VerificationFailedError({
                                    reason: 'Broadcast transaction hash does not match the signed transaction',
                                });
                            return toReceipt(receipt);
                        }
                        // Optimistic path: broadcast without waiting for confirmation
                        // (simulation above already ran). The returned receipt assumes
                        // success — callers opt in via waitForConfirmation: false.
                        const reference = await sendRawTransaction(client, {
                            serializedTransaction: serializedTransaction_final,
                        });
                        if (reference.toLowerCase() !== finalHash.toLowerCase())
                            throw new VerificationFailedError({
                                reason: 'Broadcast transaction hash does not match the signed transaction',
                            });
                        if (reservation &&
                            !(await SponsorBudget.transition(sponsorBudgetStore, reservation, 'pending')))
                            throw new VerificationFailedError({
                                reason: 'Sponsor budget reservation ownership was lost after broadcast',
                            });
                        return {
                            method: 'tempo',
                            status: 'success',
                            timestamp: new Date().toISOString(),
                            reference,
                        };
                    }
                    catch (error) {
                        if (!broadcastAttempted) {
                            if (reservation)
                                await SponsorBudget.release(sponsorBudgetStore, reservation);
                            if (finalHash && finalHash.toLowerCase() !== hash.toLowerCase())
                                await releaseHashUse(store, finalHash);
                            await releaseHashUse(store, hash);
                        }
                        throw error;
                    }
                }
            }
        },
    });
    return relay ? Relay.configure(method, relay) : method;
}
function chargeBinding(request) {
    // Exhaustively destructure so new charge request fields require an explicit binding decision.
    const { amount, currency, description, externalId, methodDetails, recipient, ...requestRest } = request;
    requestRest;
    const { chainId, feePayer, machineTokenEnabled, splits, supportedModes, ...methodDetailsRest } = methodDetails ?? {};
    methodDetailsRest;
    void feePayer;
    return {
        machineTokenEnabled,
        amount,
        chainId,
        currency,
        description,
        externalId,
        recipient,
        splits,
        supportedModes,
    };
}
function getExpectedTransfers(parameters) {
    return Charge_internal.getTransfers({
        amount: parameters.amount,
        methodDetails: {
            splits: parameters.methodDetails?.splits,
        },
        recipient: parameters.recipient,
    }).map((transfer) => ({
        ...transfer,
        ...(!transfer.memo ? { allowAnyMemo: true } : {}),
    }));
}
function assertTransferCalls(calls, parameters) {
    const transferCalls = getTransferCalls(calls);
    if (parameters.exactCount && transferCalls.length !== parameters.transfers.length)
        throw new MismatchError('Invalid transaction: no matching payment call found', {
            expectedCalls: String(parameters.transfers.length),
            actualCalls: String(transferCalls.length),
        });
    // Match memo-specific transfers before wildcards to avoid greedy
    // consumption of memo-bearing calls by allowAnyMemo entries.
    const sorted = [...parameters.transfers].sort((a, b) => {
        if (a.memo && !b.memo)
            return -1;
        if (!a.memo && b.memo)
            return 1;
        return 0;
    });
    const used = new Set();
    const matched = [];
    for (const expected of sorted) {
        const matchIndex = transferCalls.findIndex((call, index) => {
            if (used.has(index))
                return false;
            const decoded = decodeTransferCall(call, parameters.currency);
            if (!decoded)
                return false;
            if (!TempoAddress.isEqual(decoded.recipient, expected.recipient))
                return false;
            if (decoded.amount !== expected.amount)
                return false;
            if (expected.memo) {
                return decoded.memo?.toLowerCase() === expected.memo.toLowerCase();
            }
            if (expected.allowAnyMemo)
                return true;
            return decoded.memo === undefined;
        });
        if (matchIndex === -1) {
            throw new MismatchError('Invalid transaction: no matching payment call found', {
                amount: expected.amount,
                currency: parameters.currency,
                recipient: expected.recipient,
            });
        }
        used.add(matchIndex);
        matched.push(decodeTransferCall(transferCalls[matchIndex], parameters.currency));
    }
    return matched;
}
function getTransferCalls(calls) {
    const selectors = calls.map((call) => call.data?.slice(0, 10));
    const offset = selectors[0] === Selectors.approve && selectors[1] === Selectors.swapExactAmountOut ? 2 : 0;
    const transferCalls = calls.slice(offset);
    if (transferCalls.length === 0 ||
        selectors
            .slice(offset)
            .some((selector) => selector !== Selectors.transfer && selector !== Selectors.transferWithMemo)) {
        throw new MismatchError('Invalid transaction: no matching payment call found', {});
    }
    return transferCalls;
}
function decodeTransferCall(call, currency) {
    if (!call.to || !TempoAddress.isEqual(call.to, currency) || !call.data)
        return null;
    try {
        const selector = call.data.slice(0, 10);
        if (selector === Selectors.transfer) {
            const { args } = decodeFunctionData({ abi: Abis.tip20, data: call.data });
            const [recipient, amount] = args;
            return { amount: amount.toString(), recipient };
        }
        if (selector === Selectors.transferWithMemo) {
            const { args } = decodeFunctionData({ abi: Abis.tip20, data: call.data });
            const [recipient, amount, memo] = args;
            return { amount: amount.toString(), memo, recipient };
        }
    }
    catch {
        return null;
    }
    return null;
}
async function assertTransferLogs(receipt, parameters) {
    const logs = getTransferLogEffects(receipt);
    const used = new Set();
    const matched = [];
    // Match memo-specific transfers before wildcards to avoid greedy
    // consumption of memo-bearing logs by allowAnyMemo entries.
    const sorted = [...parameters.transfers].sort((a, b) => {
        if (a.memo && !b.memo)
            return -1;
        if (!a.memo && b.memo)
            return 1;
        return 0;
    });
    for (const transfer of sorted) {
        let matchIndex = -1;
        for (const [index, log] of logs.entries()) {
            if (used.has(index))
                continue;
            if (!TempoAddress.isEqual(log.address, parameters.currency))
                continue;
            if (!TempoAddress.isEqual(log.args.to, transfer.recipient))
                continue;
            if (log.args.amount.toString() !== transfer.amount)
                continue;
            const memoMatches = (() => {
                if (transfer.memo)
                    return log.kind === 'memo' && log.args.memo.toLowerCase() === transfer.memo.toLowerCase();
                if (transfer.allowAnyMemo)
                    return log.kind === 'transfer' || log.kind === 'memo';
                return log.kind === 'transfer';
            })();
            if (!memoMatches)
                continue;
            if (!(await isValidTransferSender({
                expectedSender: parameters.sender,
                sender: log.args.from,
                settlementSenders: parameters.settlementSenders,
                source: parameters.source,
                transactionSender: receipt.from,
                validateSender: parameters.validateSender,
            })))
                continue;
            matchIndex = index;
            break;
        }
        if (matchIndex === -1) {
            throw new MismatchError('Payment verification failed: no matching transfer found.', {
                amount: transfer.amount,
                currency: parameters.currency,
                recipient: transfer.recipient,
            });
        }
        used.add(matchIndex);
        matched.push(logs[matchIndex]);
    }
    return matched;
}
function getTransferLogEffects(receipt) {
    const transferLogs = parseEventLogs({
        abi: Abis.tip20,
        eventName: 'Transfer',
        logs: receipt.logs,
    }).map((log) => ({
        address: log.address,
        args: log.args,
        kind: 'transfer',
        logIndex: log.logIndex,
    }));
    const memoLogs = parseEventLogs({
        abi: Abis.tip20,
        eventName: 'TransferWithMemo',
        logs: receipt.logs,
    }).map((log) => ({
        address: log.address,
        args: log.args,
        kind: 'memo',
        logIndex: log.logIndex,
    }));
    const logs = [...transferLogs, ...memoLogs].sort((a, b) => a.logIndex - b.logIndex);
    const effects = [];
    for (let index = 0; index < logs.length; index++) {
        const log = logs[index];
        const next = logs[index + 1];
        if (next && log.kind !== next.kind && isSameTransferLog(log, next)) {
            const memoLog = log.kind === 'memo' ? log : next.kind === 'memo' ? next : undefined;
            if (!memoLog)
                continue;
            effects.push({
                address: memoLog.address,
                args: memoLog.args,
                kind: 'memo',
            });
            index++;
            continue;
        }
        effects.push({
            address: log.address,
            args: log.args,
            kind: log.kind,
        });
    }
    return effects;
}
function isSameTransferLog(a, b) {
    return (TempoAddress.isEqual(a.address, b.address) &&
        TempoAddress.isEqual(a.args.from, b.args.from) &&
        TempoAddress.isEqual(a.args.to, b.args.to) &&
        a.args.amount === b.args.amount &&
        Math.abs(a.logIndex - b.logIndex) === 1);
}
async function isValidTransferSender(parameters) {
    if (TempoAddress.isEqual(parameters.sender, parameters.expectedSender))
        return true;
    if (TempoAddress.isEqual(parameters.transactionSender, parameters.expectedSender) &&
        parameters.settlementSenders?.some((sender) => TempoAddress.isEqual(parameters.sender, sender)))
        return true;
    if (!parameters.validateSender)
        return false;
    return parameters.validateSender({
        expectedSender: parameters.expectedSender,
        sender: parameters.sender,
        source: parameters.source,
    });
}
/** @internal */
function getHashStoreKey(hash) {
    return `mppx:charge:${hash.toLowerCase()}`;
}
/** @internal */
function getProofStoreKey(challengeId) {
    return `mppx:charge:proof:${challengeId}`;
}
async function tryClaimHash(store, hash, expires) {
    return Store.tryClaim(store, getHashStoreKey(hash), expires);
}
/** @internal */
async function releaseHashUse(store, hash) {
    await store.delete(getHashStoreKey(hash));
}
function parseHashCredentialSource(parameters) {
    const { chainId, source } = parameters;
    if (!source)
        return undefined;
    const parsed = Proof.parsePkhSource(source);
    if (!parsed || (chainId !== undefined && parsed.chainId !== chainId)) {
        throw new MismatchError('Hash credential source is invalid.', {});
    }
    return parsed;
}
/** @internal */
async function tryClaimProof(store, challengeId, expires) {
    return Store.tryClaim(store, getProofStoreKey(challengeId), expires);
}
function recoverAuthorizedProofSigner(parameters) {
    const { chainId, challengeId, realm, signature, sourceAddress } = parameters;
    try {
        const envelope = SignatureEnvelope.from(signature);
        const proofHash = Proof.hash({ account: sourceAddress, chainId, challengeId, realm });
        if (envelope.type === 'keychain') {
            if (!TempoAddress.isEqual(envelope.userAddress, sourceAddress))
                return null;
            const keychainPayload = envelope.version === 'v2'
                ? keccak256(`0x04${proofHash.slice(2)}${sourceAddress.slice(2)}`)
                : proofHash;
            const signer = SignatureEnvelope.extractAddress({
                payload: keychainPayload,
                signature: envelope.inner,
            });
            const valid = SignatureEnvelope.verify(envelope.inner, {
                address: signer,
                payload: keychainPayload,
            });
            if (!valid)
                return null;
            return signer;
        }
        const signer = SignatureEnvelope.extractAddress({
            payload: proofHash,
            signature: envelope,
        });
        const valid = SignatureEnvelope.verify(envelope, {
            address: signer,
            payload: proofHash,
        });
        if (!valid)
            return null;
        return signer;
    }
    catch {
        return null;
    }
}
async function isActiveAccessKey(client, parameters) {
    try {
        const metadata = await Actions.accessKey.getMetadata(client, parameters);
        const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
        return !metadata.isRevoked && metadata.expiry > nowSeconds;
    }
    catch {
        return false;
    }
}
/** @internal */
function toReceipt(receipt) {
    const { status, transactionHash } = receipt;
    if (status !== 'success') {
        throw new Error(`Transaction reverted: ${transactionHash}`);
    }
    return {
        method: 'tempo',
        status: 'success',
        timestamp: new Date().toISOString(),
        reference: transactionHash,
    };
}
function assertChallengeBoundMemo(matchedLogs, parameters) {
    assertChallengeBoundMemos(matchedLogs.map((log) => (log.kind === 'memo' ? log.args.memo : undefined)), parameters);
}
function assertChallengeBoundCallMemo(matchedCalls, parameters) {
    assertChallengeBoundMemos(matchedCalls.map((call) => call.memo), parameters);
}
/**
 * Requires a challenge-bound attribution memo and rejects conflicting attribution
 * on matched payment transfers. Otherwise, a split payment could authorize another
 * challenge after the first challenge's replay marker expires. Unmatched transfers
 * cannot establish the binding; plain transfers and non-MPP memos remain allowed.
 * @internal
 */
function assertChallengeBoundMemos(memos, parameters) {
    let bound = false;
    for (const memo of memos) {
        if (!memo || !Attribution.isMppMemo(memo))
            continue;
        if (!Attribution.verifyServer(memo, parameters.realm) ||
            !Attribution.verifyChallengeBinding(memo, parameters.challengeId))
            throw new MismatchError('Payment verification failed: memo is not bound to this challenge.', {});
        bound = true;
    }
    if (!bound)
        throw new MismatchError('Payment verification failed: memo is not bound to this challenge.', {});
}
/** @internal */
class MismatchError extends PaymentError {
    name = 'MismatchError';
    title = 'Verification Failed';
    type = 'https://paymentauth.org/problems/verification-failed';
    constructor(reason, details) {
        super([
            reason.startsWith('Payment verification failed')
                ? reason
                : `Payment verification failed: ${reason}`,
            ...Object.entries(details).map(([k, v]) => `  - ${k}: ${v}`),
        ].join('\n'), { details });
    }
}
//# sourceMappingURL=Charge.js.map