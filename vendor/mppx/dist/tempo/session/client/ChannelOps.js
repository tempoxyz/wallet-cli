/**
 * Shared client-side TIP-1034 channel operations.
 *
 * Provides the low-level helpers that both `tempo.session()` and
 * `tempo.session.manager()` rely on: channel ID computation,
 * transaction-bound descriptor construction, on-chain open/top-up payload
 * construction, voucher/close payload serialization, and transaction signing.
 *
 * @see https://tips.sh/1034-1
 */
import { Hex } from 'ox';
import { encodeFunctionData, isAddress } from 'viem';
import { prepareTransactionRequest, signTransaction } from 'viem/actions';
import { Transaction } from 'viem/tempo';
import * as Credential from '../../../Credential.js';
import * as Channel from '../precompile/Channel.js';
import { escrowAbi } from '../precompile/escrow.abi.js';
import { tip20ChannelEscrow } from '../precompile/Protocol.js';
import { uint96 } from '../precompile/Protocol.js';
import * as Voucher from '../precompile/Voucher.js';
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function readOptionalAddress(value) {
    return typeof value === 'string' && isAddress(value, { strict: false }) ? value : undefined;
}
function readAccessKeyAddress(account) {
    return readOptionalAddress(account.accessKeyAddress);
}
/** Returns random past seconds to distinguish otherwise-identical expiring transactions. */
function randomValidAfter() {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const latest = now - 60n;
    if (latest <= 0n)
        return 0;
    return Number(BigInt(Hex.random(8)) % latest);
}
/** Resolves the voucher authority address for a client account. */
export function resolveAuthorizedSigner(account) {
    return readAccessKeyAddress(account) ?? account.address;
}
async function prepareTempoChannelTransaction(client, parameters) {
    const { account, calls, feePayer, feeToken, validAfter } = parameters;
    // Session management transactions are independent and short-lived, so they
    // always use TIP-1009 expiring nonces. `feePayer` controls sponsorship only.
    // viem's stable transaction request type does not yet expose Tempo's
    // `calls`, `feePayer`, and `feeToken` fields together. Keep the cast at
    // this boundary so session credential builders stay typed.
    return prepareTransactionRequest(client, {
        account,
        calls,
        nonceKey: 'expiring',
        ...(feePayer ? { feePayer: true } : {}),
        feeToken,
        ...(validAfter !== undefined ? { validAfter } : {}),
    });
}
async function signPreparedTempoTransaction(client, prepared) {
    return (await signTransaction(client, prepared));
}
/** Resolves the server-advertised escrow against the client's trust policy. */
export function resolveEscrow(challenge, escrowOverride, allowCustomEscrow = false) {
    const methodDetails = challenge.request.methodDetails;
    const challengeEscrow = isObject(methodDetails)
        ? (readOptionalAddress(methodDetails.escrowContract) ??
            readOptionalAddress(methodDetails.escrow))
        : undefined;
    const expectedEscrow = escrowOverride ?? tip20ChannelEscrow;
    if (challengeEscrow &&
        !isSameAddress(challengeEscrow, expectedEscrow) &&
        (!allowCustomEscrow || escrowOverride !== undefined))
        throw new Error(`Tempo session escrow ${challengeEscrow} does not match client escrow ${expectedEscrow}.`);
    if (challengeEscrow && !isSameAddress(challengeEscrow, expectedEscrow))
        return challengeEscrow;
    return expectedEscrow;
}
/** Serializes a session credential with a DID source bound to the payer account. */
export function serializeCredential(challenge, payload, chainId, account) {
    return Credential.serialize({
        challenge,
        payload,
        source: `did:pkh:eip155:${chainId}:${account.address}`,
    });
}
/** Case-insensitive EVM address equality. */
export function isSameAddress(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}
/**
 * Signs and creates a TIP-1034 voucher credential payload for an existing channel.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export async function createVoucherPayload(client, account, descriptor, cumulativeAmount, chainId, escrow = tip20ChannelEscrow) {
    const channelId = Channel.computeId({
        ...descriptor,
        chainId,
        escrow,
    });
    const amount = uint96(cumulativeAmount);
    const signature = await Voucher.signVoucher(client, account, { channelId, cumulativeAmount: amount }, escrow, chainId);
    return {
        action: 'voucher',
        channelId,
        descriptor,
        cumulativeAmount: amount.toString(),
        signature,
    };
}
/**
 * Signs and creates a TIP-1034 close credential payload for an existing channel.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export async function createClosePayload(client, account, descriptor, cumulativeAmount, chainId, escrow = tip20ChannelEscrow) {
    const voucher = await createVoucherPayload(client, account, descriptor, cumulativeAmount, chainId, escrow);
    return {
        action: 'close',
        channelId: voucher.channelId,
        descriptor,
        cumulativeAmount: voucher.cumulativeAmount,
        signature: voucher.signature,
    };
}
/**
 * Prepares, signs, and creates a TIP-1034 open credential payload.
 *
 * The channel descriptor uses the signed transaction's expiring nonce hash
 * because TIP-1034 binds each opened channel to that transaction context.
 *
 * @see https://tips.sh/1034-1#channel-identity-and-packed-state
 */
export async function createOpenPayload(client, account, parameters) {
    const authorizedSigner = resolveAuthorizedSigner(account);
    const escrow = parameters.escrow ?? tip20ChannelEscrow;
    const operator = parameters.operator ?? '0x0000000000000000000000000000000000000000';
    const salt = Hex.random(32);
    const deposit = uint96(parameters.deposit);
    const initialAmount = uint96(parameters.initialAmount);
    const openData = encodeFunctionData({
        abi: escrowAbi,
        functionName: 'open',
        args: [parameters.payee, operator, parameters.token, deposit, salt, authorizedSigner],
    });
    const prepared = await prepareTempoChannelTransaction(client, {
        account,
        calls: [...(parameters.prefixCalls ?? []), { to: escrow, data: openData }],
        feePayer: parameters.feePayer,
        feeToken: parameters.feeToken ?? parameters.token,
    });
    const transaction = await signPreparedTempoTransaction(client, prepared);
    const signed = Transaction.deserialize(transaction);
    const expiringNonceHash = Channel.computeExpiringNonceHash(Channel.transactionForExpiringNonceHash({
        ...(parameters.feePayer ? { feePayer: true } : {}),
        transaction: signed,
    }), { sender: account.address });
    const descriptor = {
        authorizedSigner,
        expiringNonceHash,
        operator,
        payee: parameters.payee,
        payer: account.address,
        salt,
        token: parameters.token,
    };
    const channelId = Channel.computeId({
        ...descriptor,
        chainId: parameters.chainId,
        escrow,
    });
    const signature = await Voucher.signVoucher(client, account, { channelId, cumulativeAmount: initialAmount }, escrow, parameters.chainId);
    return {
        action: 'open',
        type: 'transaction',
        channelId,
        transaction,
        signature,
        descriptor,
        cumulativeAmount: initialAmount.toString(),
        authorizedSigner: descriptor.authorizedSigner,
    };
}
/**
 * Prepares, signs, and creates a TIP-1034 top-up credential payload.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export async function createTopUpPayload(client, account, descriptor, additionalDeposit, chainId, feePayer, escrow = tip20ChannelEscrow, prefixCalls = [], feeToken = descriptor.token) {
    const channelId = Channel.computeId({
        ...descriptor,
        chainId,
        escrow,
    });
    const deposit = uint96(additionalDeposit);
    const prepared = await prepareTempoChannelTransaction(client, {
        account,
        calls: [
            ...prefixCalls,
            {
                to: escrow,
                data: encodeFunctionData({
                    abi: escrowAbi,
                    functionName: 'topUp',
                    args: [descriptor, deposit],
                }),
            },
        ],
        feePayer,
        feeToken,
        validAfter: randomValidAfter(),
    });
    const transaction = await signPreparedTempoTransaction(client, prepared);
    return {
        action: 'topUp',
        type: 'transaction',
        channelId,
        transaction,
        descriptor,
        additionalDeposit: deposit.toString(),
    };
}
//# sourceMappingURL=ChannelOps.js.map