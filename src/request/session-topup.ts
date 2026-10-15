import type { Mppx } from "mppx/client";
import { Session as TempoSession } from "mppx/tempo";
import { encodeFunctionData, parseUnits } from "viem";
import { prepareTransactionRequest, signTransaction } from "viem/actions";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";

import { paymentReceipt, receiptTxHash } from "../payment/receipt.js";
import { requireSessionDescriptor } from "../payment/session-descriptor.js";
import {
  type PersistedSessionRecord,
  updateSessionReceipt,
  upsertSessionRecord,
} from "../payment/session-store.js";
import { escrowAbi } from "../shared/constants.js";
import { paymentError, walletError } from "../shared/errors.js";
import { escrowContract } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { getRecord, nowSeconds, stringValue } from "../shared/utils.js";
import { type SessionDetails, tempoPaymentChallengeResponse } from "./challenge.js";
import { cloneRequestInit, type FetchPlan, type RequestInitWithDispatcher } from "./fetch.js";
import { type PaymentIdentity, requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";
import { fetchPaidRequest, paidResponseFailures, paymentReceipts } from "./paid.js";
import { formatTokenAmount, spendCap, spendCapLabel } from "./spend.js";

export async function tryTopUpAndRetry(options: {
  credential: string;
  details: SessionDetails;
  identity: PaymentIdentity;
  options: RequestOptions;
  payment: ReturnType<typeof Mppx.create>;
  paymentRequiredResponse: Response;
  record: PersistedSessionRecord;
  request: FetchPlan;
  response: Response;
  signedCumulative: bigint;
}) {
  const body = await options.response
    .clone()
    .text()
    .catch(() => "");
  const additionalDeposit = topUpAmountFromProblem(body, options.record, options.signedCumulative);
  if (additionalDeposit <= 0n) return undefined;
  const deposit = options.record.deposit + additionalDeposit;
  // This request's voucher was already sent, so a rerun with a higher cap would pay for the call
  // again; the refusal points at the session instead of suggesting one.
  if (deposit > parseUnits(spendCap(options.options), 6))
    throw walletError({
      code: "E_LIMIT_EXCEEDED",
      message: `Session top-up refused: the deposit would reach ${formatTokenAmount(deposit)}, above the spending cap (max=${spendCapLabel(options.options)}). The voucher for this request was already sent; check the session with '${continuationCommand(["wallet", "sessions", "list"], requestNetwork(options.options))}' before retrying.`,
    });

  const transaction = await buildTopUpTransaction({
    additionalDeposit,
    details: options.details,
    identity: options.identity,
    record: options.record,
  });
  const topUpCredential = await options.payment.createCredential(
    tempoPaymentChallengeResponse(options.paymentRequiredResponse),
    {
      action: "topUp",
      additionalDepositRaw: additionalDeposit.toString(),
      channelId: options.record.channel_id,
      ...(options.record.descriptor_json
        ? { descriptor: requireSessionDescriptor(options.record) }
        : {}),
      transaction,
    } as never,
  );
  const topUpInit = topUpRequestInit(options.request.init);
  const authorizedTopUp = options.payment.transport.setCredential(topUpInit, topUpCredential);
  const topUpResponse = await fetchPaidRequest(
    { init: authorizedTopUp, url: options.request.url },
    options.options,
    topUpCredential,
  );
  if (topUpResponse.status >= 400) return topUpResponse;

  try {
    await upsertSessionRecord({
      ...options.record,
      deposit: options.record.deposit + additionalDeposit,
      last_used_at: nowSeconds(),
    });
    await persistSessionReceipt(topUpResponse, options.record.channel_id, options.signedCumulative);
  } catch {
    paidResponseFailures.add(topUpResponse);
    return topUpResponse;
  }

  const paidInit = options.payment.transport.setCredential(
    cloneRequestInit(options.request.init),
    options.credential,
  );
  const retried = await fetchPaidRequest(
    { init: paidInit, url: options.request.url },
    options.options,
    options.credential,
  );
  try {
    await persistSessionReceipt(retried, options.record.channel_id, options.signedCumulative);
  } catch {
    paidResponseFailures.add(retried);
  }
  paymentReceipts.set(
    retried,
    paymentReceipt({
      intent: "session",
      amount: options.details.amount,
      token: options.details.token,
      network: requestNetwork(options.options),
      payer: options.identity.address,
      // The top-up sent the transaction; the retried voucher sends none.
      txHash: receiptTxHash(topUpResponse, options.record.channel_id),
      session: {
        channelId: options.record.channel_id,
        deposit,
        cumulative: options.signedCumulative,
        reused: true,
      },
    }),
  );
  return retried;
}

async function buildTopUpTransaction(options: {
  additionalDeposit: bigint;
  details: SessionDetails;
  identity: PaymentIdentity;
  record: PersistedSessionRecord;
}) {
  const request = buildTopUpTransactionRequest({
    additionalDeposit: options.additionalDeposit,
    details: options.details,
    record: options.record,
  });
  const client = options.identity.getClient({ chainId: options.details.chainId });
  const prepared = await prepareTransactionRequest(
    client as never,
    {
      account: (client as { account: unknown }).account,
      ...request,
    } as never,
  );
  prepared.gas = (prepared.gas ?? 0n) + 5_000n;
  return (await signTransaction(client as never, prepared as never)) as `0x${string}`;
}

export function buildTopUpTransactionRequest(options: {
  additionalDeposit: bigint;
  details: Pick<SessionDetails, "feePayer" | "token">;
  record: Pick<
    PersistedSessionRecord,
    "chain_id" | "channel_id" | "descriptor_json" | "escrow_contract" | "session_protocol"
  >;
}) {
  const isPrecompile = options.record.session_protocol === "v2";
  if (!isPrecompile && options.record.session_protocol !== "v1")
    throw paymentError(`Unsupported Tempo session protocol: ${options.record.session_protocol}`);
  const expectedEscrow = isPrecompile
    ? TempoChannel.address
    : escrowContract(options.record.chain_id);
  if (options.record.escrow_contract.toLowerCase() !== expectedEscrow.toLowerCase())
    throw paymentError(
      `Unsupported Tempo session escrow: expected ${expectedEscrow}, received ${options.record.escrow_contract}`,
    );
  const topUpData = encodeFunctionData({
    abi: isPrecompile ? TempoAbis.tip20ChannelReserve : escrowAbi,
    functionName: "topUp",
    args: isPrecompile
      ? [requireSessionDescriptor(options.record), options.additionalDeposit]
      : [options.record.channel_id as `0x${string}`, options.additionalDeposit],
  } as never);
  const calls = isPrecompile
    ? [{ to: options.record.escrow_contract as `0x${string}`, data: topUpData }]
    : [
        {
          to: options.details.token as `0x${string}`,
          data: encodeFunctionData({
            abi: tip20Abi,
            functionName: "approve",
            args: [options.record.escrow_contract as `0x${string}`, options.additionalDeposit],
          }),
        },
        { to: options.record.escrow_contract as `0x${string}`, data: topUpData },
      ];
  return {
    calls,
    ...(options.details.feePayer ? { feePayer: true } : {}),
    feeToken: options.details.token,
  };
}

function topUpRequestInit(init: RequestInitWithDispatcher) {
  const next = cloneRequestInit(init);
  next.method = "POST";
  delete next.body;
  const headers = new Headers(next.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  next.headers = headers;
  return next;
}

function topUpAmountFromProblem(
  body: string,
  record: PersistedSessionRecord,
  signedCumulative: bigint,
) {
  const problem = parseProblemDetails(body);
  if (!problem) return 0n;
  const type = `${problem.type ?? ""} ${problem.title ?? ""} ${problem.detail ?? ""}`.toLowerCase();
  if (!type.includes("insufficient") && !type.includes("exceeds") && !type.includes("deposit"))
    return 0n;
  const requiredTopUp = stringValue(problem.requiredTopUp ?? problem.required_top_up);
  if (/^\d+$/.test(requiredTopUp)) return BigInt(requiredTopUp);
  return sessionShortfall(record, signedCumulative);
}

/**
 * How far a voucher for `signedCumulative` exceeds the session's deposit (read from chain for a
 * reused session): the default top-up. The deposit it leads to is `signedCumulative`, so the
 * cumulative cap check also bounds it.
 */
export function sessionShortfall(
  record: Pick<PersistedSessionRecord, "deposit">,
  signedCumulative: bigint,
) {
  return signedCumulative > record.deposit ? signedCumulative - record.deposit : 0n;
}

function parseProblemDetails(body: string) {
  try {
    return getRecord(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

const tip20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export async function persistSessionReceipt(
  response: Response,
  channelId: string,
  signedCumulative: bigint,
) {
  const header = response.headers.get("payment-receipt");
  if (!header) return;
  const receipt = TempoSession.Precompile.Receipt.deserializeSessionReceipt(header);
  if (receipt.method !== "tempo" || receipt.intent !== "session" || receipt.status !== "success")
    return;
  if (receipt.channelId.toLowerCase() !== channelId.toLowerCase()) return;
  const acceptedCumulative = BigInt(receipt.acceptedCumulative);
  const serverSpent = BigInt(receipt.spent);
  if (serverSpent > acceptedCumulative || acceptedCumulative > signedCumulative)
    throw paymentError("Invalid session receipt cumulative values");
  await updateSessionReceipt({
    acceptedCumulative,
    channelId,
    serverSpent,
    signedCumulative,
  });
}
