import { Address, Secp256k1 } from 'ox';
import { TempoAddress, TxEnvelopeTempo } from 'ox/tempo';
import { decodeFunctionData, encodeFunctionData, maxUint256, toHex } from 'viem';
import { Abis, Addresses, Transaction } from 'viem/tempo';
import * as TempoAddress_internal from './address.js';
import * as defaults from './defaults.js';
import { defaultFeeTokens } from './fee-token.js';
import * as Selectors from './selectors.js';
/** Returns true if the serialized transaction has a Tempo envelope prefix. */
export function isTempoTransaction(serialized) {
    return (serialized?.startsWith(TxEnvelopeTempo.serializedType) === true ||
        serialized?.startsWith(TxEnvelopeTempo.feePayerMagic) === true);
}
/**
 * Allowed call patterns for fee-payer sponsored transactions.
 * Each inner array is an ordered list of function selectors.
 */
export const callScopes = [
    [Selectors.transfer],
    [Selectors.transferWithMemo],
    [Selectors.approve, Selectors.swapExactAmountOut, Selectors.transfer],
    [Selectors.approve, Selectors.swapExactAmountOut, Selectors.transferWithMemo],
];
const preservedTransactionKeys = [
    'accessList',
    'calls',
    'chainId',
    'feeToken',
    'from',
    'gas',
    'keyAuthorization',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
    'nonce',
    'nonceKey',
    'signature',
    'validAfter',
    'validBefore',
];
const rejectedTransactionKeys = [
    'blobVersionedHashes',
    'blobs',
    'data',
    'feePayerSignature',
    'gasPrice',
    'kzg',
    'maxFeePerBlobGas',
    'r',
    's',
    'sidecars',
    'to',
    'v',
    'value',
    'yParity',
];
const rewrittenTransactionKeys = ['type'];
const supportedTransactionKeys = new Set([
    ...preservedTransactionKeys,
    ...rejectedTransactionKeys,
    ...rewrittenTransactionKeys,
]);
/** Returns fee tokens that mppx allows sponsored transactions to charge. */
export function defaultAllowedFeeTokens(chainId) {
    return defaultFeeTokens(chainId);
}
/** Validates the fee-token address and, when supplied, the server's allowlist. */
export function assertAllowedFeeToken(transaction, allowedFeeTokens) {
    const { feeToken } = transaction;
    if (feeToken === undefined)
        return;
    if (typeof feeToken !== 'string' ||
        !(Address.validate(feeToken, { strict: false }) || TempoAddress.validate(feeToken)))
        throw new FeePayerValidationError('fee-sponsored transaction feeToken is invalid', {});
    const normalized = feeToken;
    if (allowedFeeTokens &&
        !allowedFeeTokens.some((allowed) => TempoAddress_internal.isEqual(allowed, normalized)))
        throw new FeePayerValidationError('fee-sponsored transaction feeToken is not allowed', {
            feeToken,
        });
}
function hostedFeePayerRequest(transaction) {
    return {
        ...(transaction.accessList?.length ? { accessList: transaction.accessList } : {}),
        calls: transaction.calls.map((call) => ({
            ...(call.to ? { to: call.to } : {}),
            ...(call.data ? { data: call.data } : {}),
            value: call.value === undefined ? '0x' : toHex(call.value),
        })),
        feePayer: true,
        from: transaction.from,
        ...(transaction.gas !== undefined ? { gas: toHex(transaction.gas) } : {}),
        ...(transaction.keyAuthorization !== undefined
            ? { keyAuthorization: transaction.keyAuthorization }
            : {}),
        ...(transaction.maxFeePerGas !== undefined
            ? { maxFeePerGas: toHex(transaction.maxFeePerGas) }
            : {}),
        ...(transaction.maxPriorityFeePerGas !== undefined
            ? { maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas) }
            : {}),
        nonce: toHex(transaction.nonce ?? 0),
        ...(transaction.nonceKey !== undefined ? { nonceKey: toHex(transaction.nonceKey) } : {}),
        type: '0x76',
        ...(transaction.validAfter !== undefined ? { validAfter: toHex(transaction.validAfter) } : {}),
        ...(transaction.validBefore !== undefined
            ? { validBefore: toHex(transaction.validBefore) }
            : {}),
    };
}
/**
 * Co-signs a sender-signed partial sponsorship envelope through a hosted
 * fee-payer transport without letting the endpoint mutate sender-committed
 * transaction fields.
 *
 * @returns The serialized co-signed transaction plus the sponsor's recovered
 *   `feePayer` address and chosen `feeToken`, so callers can pre-broadcast
 *   simulate the exact transaction the sponsor broadcasts.
 */
export async function fillHostedFeePayerTransaction(parameters) {
    const { allowedFeeTokens, challengeExpires, chainId, details, policy, request, transaction } = parameters;
    assertTransactionPolicy({
        challengeExpires,
        chainId,
        details,
        policy,
        transaction,
    });
    const result = (await request({
        method: 'eth_fillTransaction',
        params: [hostedFeePayerRequest(transaction)],
    }));
    const filled = result?.tx;
    if (!filled?.feePayerSignature)
        throw new FeePayerValidationError('hosted fee payer failed to sponsor transaction', {});
    if (typeof filled.feeToken !== 'string')
        throw new FeePayerValidationError('hosted fee payer did not return a feeToken', {});
    assertAllowedFeeToken({ feeToken: filled.feeToken }, allowedFeeTokens);
    const feePayerSignature = {
        ...filled.feePayerSignature,
        yParity: Number(filled.feePayerSignature.yParity),
    };
    const feeToken = filled.feeToken;
    // Recover the concrete sponsor address so the simulation can use a concrete
    // `feePayer` (the node rejects `eth_call` with `feePayer: true`).
    const feePayer = (() => {
        try {
            return Secp256k1.recoverAddress({
                payload: TxEnvelopeTempo.getFeePayerSignPayload(TxEnvelopeTempo.from({
                    ...transaction,
                    feePayerSignature: undefined,
                    feeToken,
                    signature: undefined,
                }), { sender: transaction.from }),
                signature: feePayerSignature,
            });
        }
        catch {
            throw new FeePayerValidationError('hosted fee payer returned an invalid feePayerSignature', {});
        }
    })();
    return {
        feePayer,
        feeToken,
        serializedTransaction: await Transaction.serialize({
            ...transaction,
            feePayer: true,
            feePayerSignature,
            feeToken,
        }),
    };
}
/**
 * Returns a transaction shape suitable for pre-broadcast simulation.
 *
 * Sponsored transactions are first simulated as calls from the sender with no
 * fee fields or signatures. This checks call execution without requiring the
 * sender to hold the fee token; transferred value and call-level balances are
 * still checked by the RPC.
 */
export function simulationTransaction(transaction, options) {
    if (options.feePayer)
        return {
            account: transaction.from,
            calls: transaction.calls,
        };
    return {
        ...transaction,
        account: transaction.from,
        calls: transaction.calls,
        feePayerSignature: undefined,
    };
}
/**
 * Returns the final fee-sponsored transaction shape for pre-broadcast
 * simulation. RPC `eth_call` does not carry either transaction signature.
 */
export function sponsoredSimulationTransaction(transaction, options) {
    const { feePayer, feeToken } = options;
    return {
        ...transaction,
        account: transaction.from,
        calls: transaction.calls,
        feePayer,
        feePayerSignature: undefined,
        ...(feeToken !== undefined ? { feeToken } : {}),
        signature: undefined,
    };
}
/**
 * Runs execution-only sender and final-envelope simulations around sponsorship.
 *
 * First, it simulates the calls with the sender as `from`, omitting fee fields
 * and signatures so the sender's fee balance is irrelevant. Next, `complete`
 * resolves the sponsor and produces the co-signed transaction. Finally, it
 * simulates that transaction with its concrete fee payer and fee token.
 *
 * `complete` runs only after sender-context execution succeeds, so a reverting
 * transaction never reaches a local signer or hosted fee-payer.
 */
export async function preflightSponsorship(parameters) {
    const { complete, simulate, transaction } = parameters;
    await simulate(simulationTransaction(transaction, { feePayer: true }));
    const completed = await complete();
    await simulate(sponsoredSimulationTransaction(completed.transaction, {
        feePayer: completed.feePayer,
        feeToken: completed.feeToken,
    }));
    return completed;
}
/**
 * maxTotalFee must be high enough to cover `transferWithMemo` and
 * swap transactions at peak gas prices. Bumped from 0.01 ETH in #327.
 */
const defaultPolicy = {
    allowKeyAuthorization: true,
    maxGas: 2000000n,
    maxFeePerGas: 100000000000n,
    maxPriorityFeePerGas: 10000000000n,
    maxTotalFee: 50000000000000000n,
    maxValidityWindowSeconds: 15 * 60,
};
const policyByChainId = {
    [defaults.chainId.mainnet]: defaultPolicy,
    // Moderato regularly needs a higher priority fee than mainnet.
    [defaults.chainId.testnet]: {
        ...defaultPolicy,
        maxPriorityFeePerGas: 50000000000n,
    },
};
function getPolicy(chainId, overrides) {
    const base = policyByChainId[chainId] ?? defaultPolicy;
    if (!overrides)
        return base;
    return {
        allowKeyAuthorization: overrides.allowKeyAuthorization ?? base.allowKeyAuthorization,
        maxGas: overrides.maxGas ?? base.maxGas,
        maxFeePerGas: overrides.maxFeePerGas ?? base.maxFeePerGas,
        maxPriorityFeePerGas: overrides.maxPriorityFeePerGas ?? base.maxPriorityFeePerGas,
        maxTotalFee: overrides.maxTotalFee ?? base.maxTotalFee,
        maxValidityWindowSeconds: overrides.maxValidityWindowSeconds ?? base.maxValidityWindowSeconds,
    };
}
function isExpiringNonceKey(nonceKey) {
    return nonceKey === 'expiring' || nonceKey === maxUint256;
}
const sponsoredCallAbi = [...Abis.tip20, ...Abis.stablecoinDex];
const sponsoredCallSelectors = new Set([
    Selectors.approve,
    Selectors.transfer,
    Selectors.transferWithMemo,
    Selectors.swapExactAmountOut,
]);
function canonicalSponsoredCallData(data, call, fail) {
    if (!sponsoredCallSelectors.has(data.slice(0, 10)))
        return undefined;
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: sponsoredCallAbi, data });
    }
    catch {
        fail('fee-sponsored transaction call calldata is invalid', { call });
    }
    return encodeFunctionData({
        abi: sponsoredCallAbi,
        functionName: decoded.functionName,
        args: decoded.args,
    });
}
/**
 * Rejects sponsored transaction fields that increase intrinsic gas without
 * changing the decoded payment intent.
 */
function assertCanonicalSponsoredTransaction(transaction, fail) {
    if (transaction.accessList !== undefined && transaction.accessList.length > 0)
        fail('fee-sponsored transaction accessList is not allowed', {
            accessListEntries: String(transaction.accessList.length),
        });
    const calls = transaction.calls;
    if (!Array.isArray(calls) || calls.length === 0)
        fail('fee-sponsored transaction must declare calls');
    for (const [index, call] of calls.entries()) {
        const callIndex = String(index);
        const value = call.value;
        if (value !== undefined && value !== 0n)
            fail('fee-sponsored transaction call value is not allowed', {
                call: callIndex,
                value: value.toString(),
            });
        const data = call.data;
        if (!data)
            fail('fee-sponsored transaction call is missing calldata', {
                call: callIndex,
            });
        const canonical = canonicalSponsoredCallData(data, callIndex, fail);
        if (canonical && data.toLowerCase() !== canonical.toLowerCase())
            fail('fee-sponsored transaction call calldata is not canonical', {
                call: callIndex,
            });
    }
}
/** Validates that a set of transaction calls matches an allowed fee-payer pattern. */
export function validateCalls(calls, details, options) {
    if (calls.length === 0)
        throw new FeePayerValidationError('disallowed call pattern in fee-payer transaction', details);
    const callSelectors = calls.map((c) => c.data?.slice(0, 10));
    const hasSwapPrefix = callSelectors[0] === Selectors.approve;
    if (hasSwapPrefix) {
        if (callSelectors[1] !== Selectors.swapExactAmountOut)
            throw new FeePayerValidationError('disallowed call pattern in fee-payer transaction', details);
    }
    else if (callSelectors[0] === Selectors.swapExactAmountOut) {
        throw new FeePayerValidationError('disallowed call pattern in fee-payer transaction', details);
    }
    const transferSelectors = callSelectors.slice(hasSwapPrefix ? 2 : 0);
    if (transferSelectors.length === 0)
        throw new FeePayerValidationError('disallowed call pattern in fee-payer transaction', details);
    const expectedTransfers = options?.expectedTransfers;
    const transferLimit = expectedTransfers?.length ?? 11;
    if (transferSelectors.length > transferLimit ||
        transferSelectors.some((selector) => selector !== Selectors.transfer && selector !== Selectors.transferWithMemo) ||
        (expectedTransfers && transferSelectors.length !== expectedTransfers.length))
        throw new FeePayerValidationError('disallowed call pattern in fee-payer transaction', details);
    // Bind the swap approval to the token the DEX call will actually spend.
    const buyCall = calls.find((c) => c.data?.slice(0, 10) === Selectors.swapExactAmountOut);
    const buyArgs = buyCall
        ? decodeFunctionData({ abi: Abis.stablecoinDex, data: buyCall.data }).args
        : undefined;
    const approveCall = calls.find((c) => c.data?.slice(0, 10) === Selectors.approve);
    if (approveCall) {
        const { args } = decodeFunctionData({ abi: Abis.tip20, data: approveCall.data });
        const [spender, amount] = args;
        if (!approveCall.to || (buyArgs && !TempoAddress_internal.isEqual(approveCall.to, buyArgs[0])))
            throw new FeePayerValidationError('approve target does not match swap tokenIn', details);
        if (!TempoAddress_internal.isEqual(spender, Addresses.stablecoinDex))
            throw new FeePayerValidationError('approve spender is not the DEX', details);
        if (buyArgs && amount !== buyArgs[3])
            throw new FeePayerValidationError('approve amount does not match swap max input', details);
    }
    if (buyCall &&
        (!buyCall.to || !TempoAddress_internal.isEqual(buyCall.to, Addresses.stablecoinDex)))
        throw new FeePayerValidationError('buy target is not the DEX', details);
    if (!expectedTransfers)
        return;
    const currency = options?.currency ?? details.currency;
    if (!currency)
        throw new FeePayerValidationError('missing payment currency', details);
    if (buyArgs) {
        const [, tokenOut, amountOut] = buyArgs;
        const expectedAmountOut = expectedTransfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
        if (!TempoAddress_internal.isEqual(tokenOut, currency))
            throw new FeePayerValidationError('swap tokenOut does not match payment currency', details);
        if (amountOut !== expectedAmountOut)
            throw new FeePayerValidationError('swap output does not match payment amount', details);
    }
    const transferCalls = calls.slice(hasSwapPrefix ? 2 : 0);
    const sorted = [...expectedTransfers].sort((a, b) => {
        if (a.memo && !b.memo)
            return -1;
        if (!a.memo && b.memo)
            return 1;
        return 0;
    });
    const used = new Set();
    for (const expected of sorted) {
        const matchIndex = transferCalls.findIndex((call, index) => {
            if (used.has(index))
                return false;
            if (!call.to || !TempoAddress_internal.isEqual(call.to, currency) || !call.data)
                return false;
            try {
                const selector = call.data.slice(0, 10);
                const { args } = decodeFunctionData({ abi: Abis.tip20, data: call.data });
                if (selector === Selectors.transfer) {
                    const [recipient, amount] = args;
                    if (!TempoAddress_internal.isEqual(recipient, expected.recipient))
                        return false;
                    if (amount.toString() !== expected.amount)
                        return false;
                    return expected.memo === undefined;
                }
                if (selector === Selectors.transferWithMemo) {
                    const [recipient, amount, memo] = args;
                    if (!TempoAddress_internal.isEqual(recipient, expected.recipient))
                        return false;
                    if (amount.toString() !== expected.amount)
                        return false;
                    if (expected.memo)
                        return memo.toLowerCase() === expected.memo.toLowerCase();
                    return expected.allowAnyMemo === true;
                }
            }
            catch {
                return false;
            }
            return false;
        });
        if (matchIndex === -1)
            throw new FeePayerValidationError('payment transfer does not match challenge', details);
        used.add(matchIndex);
    }
}
/** Validates sponsor fee policy limits for a fee-payer transaction. */
export function assertTransactionPolicy(parameters) {
    const { challengeExpires, chainId, details, now = new Date(), policy: policyOverrides, transaction, } = parameters;
    const policy = getPolicy(chainId, policyOverrides);
    const { chainId: transactionChainId, gas, maxFeePerGas, maxPriorityFeePerGas, nonceKey, validBefore, } = transaction;
    const fail = (reason, extra = {}) => {
        throw new FeePayerValidationError(reason, { ...details, ...extra });
    };
    if (transaction.type !== undefined && transaction.type !== 'tempo')
        fail('fee-sponsored transaction type is invalid', {
            type: String(transaction.type),
        });
    if (transactionChainId !== chainId)
        fail('fee-sponsored transaction chainId does not match challenge', {
            chainId: String(transactionChainId),
        });
    assertCanonicalSponsoredTransaction(transaction, fail);
    if (transaction.keyAuthorization !== undefined && !policy.allowKeyAuthorization)
        fail('fee-sponsored transaction keyAuthorization is not allowed');
    if (gas === undefined || gas <= 0n)
        fail('fee-sponsored transaction must declare gas');
    const gasLimit = gas;
    if (gasLimit > policy.maxGas)
        fail('fee-sponsored transaction gas exceeds sponsor policy', {
            gas: gasLimit.toString(),
        });
    if (maxFeePerGas === undefined || maxFeePerGas <= 0n)
        fail('fee-sponsored transaction must declare maxFeePerGas');
    const maxFeePerGasValue = maxFeePerGas;
    if (maxFeePerGasValue > policy.maxFeePerGas)
        fail('fee-sponsored transaction maxFeePerGas exceeds sponsor policy', {
            maxFeePerGas: maxFeePerGasValue.toString(),
        });
    const maxTotalFee = BigInt(gasLimit) * BigInt(maxFeePerGasValue);
    if (maxTotalFee > policy.maxTotalFee)
        fail('fee-sponsored transaction total fee budget exceeds sponsor policy', {
            gas: gasLimit.toString(),
            maxFeePerGas: maxFeePerGasValue.toString(),
            totalFee: maxTotalFee.toString(),
        });
    if (maxPriorityFeePerGas !== undefined && maxPriorityFeePerGas > maxFeePerGasValue)
        fail('fee-sponsored transaction maxPriorityFeePerGas exceeds maxFeePerGas', {
            maxFeePerGas: maxFeePerGasValue.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        });
    if (maxPriorityFeePerGas !== undefined && maxPriorityFeePerGas > policy.maxPriorityFeePerGas)
        fail('fee-sponsored transaction maxPriorityFeePerGas exceeds sponsor policy', {
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        });
    if (!isExpiringNonceKey(nonceKey))
        fail('fee-sponsored transaction must use an expiring nonce');
    if (validBefore === undefined)
        fail('fee-sponsored transaction must declare validBefore for the expiring nonce');
    const validBeforeValue = validBefore;
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (validBeforeValue <= nowSeconds)
        fail('fee-sponsored transaction has already expired', {
            validBefore: String(validBeforeValue),
        });
    const challengeExpirySeconds = challengeExpires
        ? Math.floor(new Date(challengeExpires).getTime() / 1_000)
        : undefined;
    const maxValidBefore = Math.min(nowSeconds + policy.maxValidityWindowSeconds, challengeExpirySeconds ? challengeExpirySeconds + 60 : Number.MAX_SAFE_INTEGER);
    if (validBeforeValue > maxValidBefore)
        fail('fee-sponsored transaction validity window exceeds sponsor policy', {
            validBefore: String(validBeforeValue),
        });
    return {
        gasLimit,
        maxFeePerGasValue,
        totalFee: maxTotalFee,
        validBeforeValue,
    };
}
export function prepareSponsoredTransaction(parameters) {
    const { account, allowedFeeTokens, challengeExpires, chainId, details, now = new Date(), policy: policyOverrides, transaction, } = parameters;
    const transactionRecord = transaction;
    const { accessList, calls, chainId: transactionChainId, feeToken, from, keyAuthorization, maxPriorityFeePerGas, nonce, nonceKey, signature, validAfter, } = transaction;
    const fail = (reason, extra = {}) => {
        throw new FeePayerValidationError(reason, { ...details, ...extra });
    };
    const unsupportedKeys = Object.entries(transaction).flatMap(([key, value]) => {
        if (value === undefined)
            return [];
        if (supportedTransactionKeys.has(key))
            return [];
        return [key];
    });
    if (unsupportedKeys.length > 0)
        fail('fee-sponsored transaction contains unsupported fields', {
            unsupportedFields: unsupportedKeys.join(', '),
        });
    const rejectedKeys = rejectedTransactionKeys.filter((key) => {
        const value = transactionRecord[key];
        return value !== undefined && value !== null;
    });
    if (rejectedKeys.length > 0)
        fail('fee-sponsored transaction contains rejected fields', {
            rejectedFields: rejectedKeys.join(', '),
        });
    const { gasLimit, maxFeePerGasValue, validBeforeValue } = assertTransactionPolicy({
        challengeExpires,
        chainId,
        details,
        now,
        policy: policyOverrides,
        transaction,
    });
    const normalizedFeeToken = (() => {
        if (feeToken === undefined)
            return undefined;
        if (typeof feeToken !== 'string')
            fail('fee-sponsored transaction feeToken is invalid');
        return feeToken;
    })();
    if (normalizedFeeToken !== undefined) {
        if (allowedFeeTokens &&
            !allowedFeeTokens.some((allowed) => TempoAddress_internal.isEqual(normalizedFeeToken, allowed)))
            fail('fee-sponsored transaction feeToken is not allowed', {
                feeToken: normalizedFeeToken,
            });
    }
    return {
        accessList,
        account,
        calls,
        chainId: transactionChainId,
        feePayer: account,
        ...(normalizedFeeToken ? { feeToken: normalizedFeeToken } : {}),
        ...(from ? { from } : {}),
        gas: gasLimit,
        ...(keyAuthorization !== undefined ? { keyAuthorization } : {}),
        ...(nonce !== undefined ? { nonce } : {}),
        maxFeePerGas: maxFeePerGasValue,
        ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
        nonceKey,
        ...(signature ? { signature } : {}),
        type: 'tempo',
        ...(validAfter !== undefined ? { validAfter } : {}),
        validBefore: validBeforeValue,
    };
}
export class FeePayerValidationError extends Error {
    name = 'FeePayerValidationError';
    constructor(reason, details) {
        super([
            `Invalid transaction: ${reason}`,
            ...Object.entries(details).map(([k, v]) => `  - ${k}: ${v}`),
        ].join('\n'));
    }
}
//# sourceMappingURL=fee-payer.js.map