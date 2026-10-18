import { decodeFunctionData, encodeFunctionData, erc20Abi, getAbiItem, toFunctionSelector, } from 'viem';
import { call, prepareTransactionRequest, readContract, sendRawTransaction, sendRawTransactionSync, signTransaction, } from 'viem/actions';
import { Transaction } from 'viem/tempo';
import { BadRequestError, ChannelClosedError, VerificationFailedError } from '../../../Errors.js';
import * as TempoAddress from '../../internal/address.js';
import * as defaults from '../../internal/defaults.js';
import * as FeePayer from '../../internal/fee-payer.js';
import { resolveFeeToken } from '../../internal/fee-token.js';
import * as Channel from './Channel.js';
import { escrowAbi } from './escrow.abi.js';
export { escrowAbi };
/**
 * Asserts that a deserialized transaction has an existing sender signature —
 * required before fee payer co-signing to prevent the fee payer from becoming
 * the sender.
 */
function assertSenderSigned(transaction) {
    if (!transaction.signature || !transaction.from)
        throw new BadRequestError({
            reason: 'Transaction must be signed by the sender before fee payer co-signing',
        });
}
const UINT128_MAX = 2n ** 128n - 1n;
/**
 * Read channel state from the escrow contract.
 */
export async function getOnChainChannel(client, escrowContract, channelId) {
    return readContract(client, {
        address: escrowContract,
        abi: escrowAbi,
        functionName: 'getChannel',
        args: [channelId],
    });
}
/**
 * Verify a topUp by re-reading on-chain channel state.
 */
export async function verifyTopUpTransaction(client, escrowContract, channelId, previousDeposit) {
    const channel = await getOnChainChannel(client, escrowContract, channelId);
    if (channel.finalized) {
        throw new ChannelClosedError({ reason: 'channel is finalized on-chain' });
    }
    if (channel.deposit <= previousDeposit) {
        throw new VerificationFailedError({ reason: 'channel deposit did not increase' });
    }
    return { deposit: channel.deposit };
}
function assertUint128(amount) {
    if (amount < 0n || amount > UINT128_MAX) {
        throw new VerificationFailedError({ reason: 'cumulativeAmount exceeds uint128 range' });
    }
}
/**
 * Submit a settle transaction on-chain.
 */
export async function settleOnChain(client, escrowContract, voucher, options) {
    assertUint128(voucher.cumulativeAmount);
    const resolved = options?.account ?? client.account;
    if (!resolved)
        throw new Error('Cannot settle channel: no account available. Pass an `account` to tempo.settle(), or provide a `getClient` that returns an account-bearing client.');
    const args = [voucher.channelId, voucher.cumulativeAmount, voucher.signature];
    if (options?.feePayer) {
        const data = encodeFunctionData({ abi: escrowAbi, functionName: 'settle', args });
        return sendFeePayerTx(client, resolved, options.feePayer, escrowContract, data, 'settle', options.candidateFeeTokens);
    }
    return sendAccountTx(client, resolved, escrowContract, encodeFunctionData({ abi: escrowAbi, functionName: 'settle', args }), 'settle', options?.candidateFeeTokens);
}
/**
 * Submit a close transaction on-chain.
 */
export async function closeOnChain(client, escrowContract, voucher, options) {
    assertUint128(voucher.cumulativeAmount);
    const resolved = options?.account ?? client.account;
    if (!resolved)
        throw new Error('Cannot close channel: no account available. Pass an `account` (viem Account, e.g. privateKeyToAccount("0x...")) to tempo.session(), or provide a `getClient` that returns an account-bearing client.');
    const args = [voucher.channelId, voucher.cumulativeAmount, voucher.signature];
    if (options?.feePayer) {
        const data = encodeFunctionData({ abi: escrowAbi, functionName: 'close', args });
        return sendFeePayerTx(client, resolved, options.feePayer, escrowContract, data, 'close', options.candidateFeeTokens);
    }
    return sendAccountTx(client, resolved, escrowContract, encodeFunctionData({ abi: escrowAbi, functionName: 'close', args }), 'close', options?.candidateFeeTokens);
}
async function sendAccountTx(client, account, to, data, label, candidateFeeTokens) {
    const feeToken = await resolveFeeToken({
        account: account.address,
        candidateTokens: candidateFeeTokens,
        client,
    });
    const prepared = await prepareTransactionRequest(client, {
        account,
        calls: [{ to, data }],
        ...(feeToken ? { feeToken } : {}),
    });
    prepared.gas = prepared.gas + 5000n;
    const serialized = (await signTransaction(client, {
        ...prepared,
        account,
    }));
    const receipt = await sendRawTransactionSync(client, {
        serializedTransaction: serialized,
    });
    if (receipt.status !== 'success') {
        throw new VerificationFailedError({
            reason: `${label} transaction reverted: ${receipt.transactionHash}`,
        });
    }
    return receipt.transactionHash;
}
/**
 * Build, sign, and broadcast a fee-sponsored type-0x76 transaction.
 *
 * Follows the same signTransaction + sendRawTransactionSync pattern used
 * by broadcastOpenTransaction / broadcastTopUpTransaction, but originates
 * the transaction server-side (estimating gas and fees first).
 *
 * @param account - The logical sender / msg.sender (e.g. the payee).
 * @param feePayer - The gas sponsor — only co-signs to cover fees.
 */
async function sendFeePayerTx(client, account, feePayer, to, data, label, candidateFeeTokens) {
    const feeToken = await resolveFeeToken({
        account: feePayer.address,
        candidateTokens: candidateFeeTokens,
        client,
    });
    const prepared = await prepareTransactionRequest(client, {
        account,
        calls: [{ to, data }],
        ...(feeToken ? { feeToken } : {}),
        nonceKey: 'expiring',
        validBefore: Math.floor(Date.now() / 1_000) + 25,
    });
    // Estimate before enabling fee-payer mode so Tempo includes sender
    // signature verification costs in the gas budget.
    prepared.gas = (prepared.gas ?? 0n) + 5000n;
    prepared.feePayer = true;
    const serialized = (await signTransaction(client, {
        ...prepared,
        account,
        feePayer,
    }));
    const receipt = await sendRawTransactionSync(client, {
        serializedTransaction: serialized,
    });
    if (receipt.status !== 'success') {
        throw new VerificationFailedError({
            reason: `${label} transaction reverted: ${receipt.transactionHash}`,
        });
    }
    return receipt.transactionHash;
}
const escrowOpenSelector = /*#__PURE__*/ toFunctionSelector(getAbiItem({ abi: escrowAbi, name: 'open' }));
const escrowTopUpSelector = /*#__PURE__*/ toFunctionSelector(getAbiItem({ abi: escrowAbi, name: 'topUp' }));
const erc20ApproveSelector = /*#__PURE__*/ toFunctionSelector('function approve(address spender, uint256 amount)');
function assertCallHasTargetAndData(call) {
    if (!call.to || !call.data) {
        throw new BadRequestError({
            reason: 'fee-sponsored transactions must not contain calls without target or data',
        });
    }
    return { to: call.to, data: call.data };
}
function validateSponsoredApproveCall(parameters) {
    const { action, call, currency, escrowContract, expectedAmount } = parameters;
    const { to, data } = assertCallHasTargetAndData(call);
    if (!TempoAddress.isEqual(to, currency) || data.slice(0, 10) !== erc20ApproveSelector) {
        throw new BadRequestError({
            reason: `fee-sponsored ${action} transaction contains an unauthorized call`,
        });
    }
    const { args } = decodeFunctionData({ abi: erc20Abi, data });
    const [spender, amount] = args;
    if (!TempoAddress.isEqual(spender, escrowContract)) {
        throw new BadRequestError({
            reason: `fee-sponsored ${action} transaction approve spender does not match escrow contract`,
        });
    }
    if (amount !== expectedAmount) {
        throw new BadRequestError({
            reason: `fee-sponsored ${action} transaction approve amount does not match requested amount`,
        });
    }
}
function validateSponsoredOpenCalls(parameters) {
    const { calls, currency, escrowContract, deposit } = parameters;
    let openCall;
    let approveCall;
    for (const call of calls) {
        const { to, data } = assertCallHasTargetAndData(call);
        const selector = data.slice(0, 10);
        const isOpen = TempoAddress.isEqual(to, escrowContract) && selector === escrowOpenSelector;
        const isApprove = TempoAddress.isEqual(to, currency) && selector === erc20ApproveSelector;
        if (isApprove) {
            if (approveCall || openCall) {
                throw new BadRequestError({
                    reason: 'fee-sponsored open transaction contains a smuggled call',
                });
            }
            approveCall = call;
            continue;
        }
        if (isOpen) {
            if (openCall) {
                throw new BadRequestError({
                    reason: 'fee-sponsored open transaction contains a smuggled call',
                });
            }
            openCall = call;
            continue;
        }
        throw new BadRequestError({
            reason: 'fee-sponsored open transaction contains an unauthorized call',
        });
    }
    if (approveCall) {
        validateSponsoredApproveCall({
            action: 'open',
            call: approveCall,
            currency,
            escrowContract,
            expectedAmount: deposit,
        });
    }
    return openCall;
}
function validateSponsoredTopUpCalls(parameters) {
    const { calls, currency, escrowContract, topUpAmount } = parameters;
    let topUpCall;
    let approveCall;
    for (const call of calls) {
        const { to, data } = assertCallHasTargetAndData(call);
        const selector = data.slice(0, 10);
        const isTopUp = TempoAddress.isEqual(to, escrowContract) && selector === escrowTopUpSelector;
        const isApprove = TempoAddress.isEqual(to, currency) && selector === erc20ApproveSelector;
        if (isApprove) {
            if (approveCall || topUpCall) {
                throw new BadRequestError({
                    reason: 'fee-sponsored topUp transaction contains a smuggled call',
                });
            }
            approveCall = call;
            continue;
        }
        if (isTopUp) {
            if (topUpCall) {
                throw new BadRequestError({
                    reason: 'fee-sponsored topUp transaction contains a smuggled call',
                });
            }
            topUpCall = call;
            continue;
        }
        throw new BadRequestError({
            reason: 'fee-sponsored topUp transaction contains an unauthorized call',
        });
    }
    if (approveCall) {
        validateSponsoredApproveCall({
            action: 'topUp',
            call: approveCall,
            currency,
            escrowContract,
            expectedAmount: topUpAmount,
        });
    }
    return topUpCall;
}
export async function broadcastOpenTransaction(parameters) {
    const { client, serializedTransaction, escrowContract, channelId, recipient, currency, challengeExpires, feePayerPolicy, feePayer, isSponsored = Boolean(feePayer), beforeBroadcast, waitForConfirmation = true, } = parameters;
    if (isSponsored && !FeePayer.isTempoTransaction(serializedTransaction))
        throw new BadRequestError({
            reason: 'Only Tempo (0x76/0x78) transactions are supported',
        });
    const transaction = Transaction.deserialize(serializedTransaction);
    if (isSponsored)
        assertSenderSigned(transaction);
    const calls = transaction.calls ?? [];
    const sponsoredOpenCall = isSponsored
        ? validateSponsoredOpenCalls({
            calls,
            currency,
            escrowContract,
            deposit: (() => {
                const candidate = calls.find((call) => {
                    if (!call.to || !TempoAddress.isEqual(call.to, escrowContract))
                        return false;
                    if (!call.data)
                        return false;
                    return call.data.slice(0, 10) === escrowOpenSelector;
                });
                if (!candidate?.data)
                    throw new BadRequestError({
                        reason: 'transaction does not contain a valid escrow open call',
                    });
                const { args } = decodeFunctionData({ abi: escrowAbi, data: candidate.data });
                return args[2];
            })(),
        })
        : undefined;
    const openCall = sponsoredOpenCall ??
        calls.find((call) => {
            if (!call.to || !TempoAddress.isEqual(call.to, escrowContract))
                return false;
            if (!call.data)
                return false;
            return call.data.slice(0, 10) === escrowOpenSelector;
        });
    if (!openCall)
        throw new BadRequestError({
            reason: 'transaction does not contain a valid escrow open call',
        });
    const { args: openArgs } = decodeFunctionData({ abi: escrowAbi, data: openCall.data });
    const [payee, token, deposit, salt, authorizedSigner] = openArgs;
    if (!TempoAddress.isEqual(payee, recipient)) {
        throw new VerificationFailedError({
            reason: 'open transaction payee does not match server recipient',
        });
    }
    if (!TempoAddress.isEqual(token, currency)) {
        throw new VerificationFailedError({
            reason: 'open transaction token does not match server currency',
        });
    }
    if (!transaction.from)
        throw new BadRequestError({ reason: 'open transaction has no sender' });
    const derivedChannelId = Channel.computeId({
        payer: transaction.from,
        payee,
        token,
        salt,
        authorizedSigner,
        escrowContract,
        chainId: client.chain.id,
    });
    if (derivedChannelId.toLowerCase() !== channelId.toLowerCase())
        throw new VerificationFailedError({
            reason: 'open transaction does not match claimed channelId',
        });
    const defaultFeeToken = defaults.currency[client.chain?.id];
    const resolvedFeeToken = transaction.feeToken ?? defaultFeeToken;
    const pendingOnChain = {
        finalized: false,
        closeRequestedAt: 0n,
        payer: transaction.from,
        payee,
        token,
        authorizedSigner,
        deposit,
        settled: 0n,
    };
    await beforeBroadcast?.(pendingOnChain);
    const completeTransaction = async () => {
        if (feePayer) {
            if (!sponsoredOpenCall)
                throw new BadRequestError({
                    reason: 'transaction does not contain a valid escrow open call',
                });
            const completed = await FeePayer.preflightSponsorship({
                transaction,
                simulate: (request) => call(client, request),
                async complete() {
                    const sponsored = FeePayer.prepareSponsoredTransaction({
                        account: feePayer,
                        allowedFeeTokens: defaultFeeToken ? [defaultFeeToken] : undefined,
                        challengeExpires,
                        chainId: client.chain.id,
                        details: { channelId, currency, recipient },
                        policy: feePayerPolicy,
                        transaction: {
                            ...transaction,
                            ...(resolvedFeeToken ? { feeToken: resolvedFeeToken } : {}),
                        },
                    });
                    return { feePayer: feePayer.address, transaction: sponsored };
                },
            });
            return signTransaction(client, completed.transaction);
        }
        return serializedTransaction;
    };
    if (!waitForConfirmation) {
        const serializedTransaction_final = await completeTransaction();
        // Local sponsorship already ran sender-context preflight above. Every
        // other optimistic path must still simulate before returning calldata as
        // pending on-chain state, including hosted sponsorship (`isSponsored`).
        if (!feePayer)
            await call(client, FeePayer.simulationTransaction(transaction, { feePayer: isSponsored }));
        const txHash = await sendRawTransaction(client, {
            serializedTransaction: serializedTransaction_final,
        });
        return {
            txHash,
            onChain: pendingOnChain,
        };
    }
    let txHash;
    try {
        // Keep local preflight inside recovery: a retry can legitimately revert
        // during simulation after the original open was mined.
        const serializedTransaction_final = await completeTransaction();
        const receipt = await sendRawTransactionSync(client, {
            serializedTransaction: serializedTransaction_final,
        });
        if (receipt.status !== 'success') {
            throw new VerificationFailedError({
                reason: `open transaction reverted: ${receipt.transactionHash}`,
            });
        }
        txHash = receipt.transactionHash;
    }
    catch (error) {
        const onChain = await getOnChainChannel(client, escrowContract, channelId);
        if (onChain.deposit > 0n) {
            return { txHash: undefined, onChain };
        }
        throw error;
    }
    const onChain = await getOnChainChannel(client, escrowContract, channelId);
    return { txHash, onChain };
}
export async function broadcastTopUpTransaction(parameters) {
    const { client, serializedTransaction, escrowContract, channelId, currency, declaredDeposit, previousDeposit, challengeExpires, feePayerPolicy, feePayer, isSponsored = Boolean(feePayer), } = parameters;
    if (isSponsored && !FeePayer.isTempoTransaction(serializedTransaction))
        throw new BadRequestError({
            reason: 'Only Tempo (0x76/0x78) transactions are supported',
        });
    const transaction = Transaction.deserialize(serializedTransaction);
    if (isSponsored)
        assertSenderSigned(transaction);
    const calls = transaction.calls ?? [];
    const sponsoredTopUpCall = isSponsored
        ? validateSponsoredTopUpCalls({
            calls,
            currency,
            escrowContract,
            topUpAmount: declaredDeposit,
        })
        : undefined;
    const topUpCall = sponsoredTopUpCall ??
        calls.find((call) => {
            if (!call.to || !TempoAddress.isEqual(call.to, escrowContract))
                return false;
            if (!call.data)
                return false;
            return call.data.slice(0, 10) === escrowTopUpSelector;
        });
    if (!topUpCall)
        throw new BadRequestError({
            reason: 'transaction does not contain a valid escrow topUp call',
        });
    const { args: topUpArgs } = decodeFunctionData({ abi: escrowAbi, data: topUpCall.data });
    const [txChannelId, txAmount] = topUpArgs;
    if (txChannelId.toLowerCase() !== channelId.toLowerCase()) {
        throw new VerificationFailedError({
            reason: 'topUp transaction channelId does not match payload channelId',
        });
    }
    if (BigInt(txAmount) !== declaredDeposit) {
        throw new VerificationFailedError({
            reason: `topUp transaction amount (${txAmount}) does not match declared additionalDeposit (${declaredDeposit})`,
        });
    }
    const serializedTransaction_final = await (async () => {
        if (feePayer) {
            if (!sponsoredTopUpCall)
                throw new BadRequestError({
                    reason: 'transaction does not contain a valid escrow topUp call',
                });
            const defaultFeeToken = defaults.currency[client.chain?.id];
            const completed = await FeePayer.preflightSponsorship({
                transaction,
                simulate: (request) => call(client, request),
                async complete() {
                    const sponsored = FeePayer.prepareSponsoredTransaction({
                        account: feePayer,
                        allowedFeeTokens: defaultFeeToken ? [defaultFeeToken] : undefined,
                        challengeExpires,
                        chainId: client.chain.id,
                        details: {
                            additionalDeposit: declaredDeposit.toString(),
                            channelId,
                            currency,
                        },
                        policy: feePayerPolicy,
                        transaction: {
                            ...transaction,
                            ...((transaction.feeToken ?? defaultFeeToken)
                                ? { feeToken: transaction.feeToken ?? defaultFeeToken }
                                : {}),
                        },
                    });
                    return { feePayer: feePayer.address, transaction: sponsored };
                },
            });
            return signTransaction(client, completed.transaction);
        }
        return serializedTransaction;
    })();
    const receipt = await sendRawTransactionSync(client, {
        serializedTransaction: serializedTransaction_final,
    });
    if (receipt.status !== 'success') {
        throw new VerificationFailedError({
            reason: `topUp transaction reverted: ${receipt.transactionHash}`,
        });
    }
    const onChain = await getOnChainChannel(client, escrowContract, channelId);
    if (onChain.deposit <= previousDeposit) {
        throw new VerificationFailedError({ reason: 'channel deposit did not increase after topUp' });
    }
    return { txHash: receipt.transactionHash, newDeposit: onChain.deposit };
}
//# sourceMappingURL=Chain.js.map