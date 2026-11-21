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
import { assertCanFund, readFundingCapacity, spendableAmount } from "./funding.js";
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
  const required = topUpAmountFromProblem(body, options.record, options.signedCumulative);
  if (required <= 0n) return undefined;
  const cap = parseUnits(spendCap(options.options), 6);
  // This request's voucher was already sent, so a rerun with a higher cap would pay for the call
  // again; the refusal points at the session instead of suggesting one.
  if (options.record.deposit + required > cap)
    throw walletError({
      code: "E_LIMIT_EXCEEDED",
      message: `Session top-up refused: the deposit would reach ${formatTokenAmount(options.record.deposit + required)}, above the spending cap (max=${spendCapLabel(options.options)}). The voucher for this request was already sent; check the session with '${continuationCommand(["wallet", "sessions", "list"], requestNetwork(options.options))}' before retrying.`,
    });
  const network = requestNetwork(options.options);
  const capacity = await readFundingCapacity(options.identity, {
    chainId: options.details.chainId,
    token: options.details.token,
  });
  const sized = topUpAmount({
    // Only a known allowance may lift the top-up above the shortfall: an unread limit could be
    // below the chunk, and the chain would reject it.
    available: capacity.allowance.kind === "unknown" ? required : spendableAmount(capacity),
    cap,
    deposit: options.record.deposit,
    explicitCap: options.options.maxSpend !== undefined,
    required,
    suggestedDeposit: options.details.suggestedDeposit,
  });
  assertCanFund(options.identity, {
    amount: sized,
    capacity,
    // The retry signs a voucher one call higher, so a limit of only this top-up falls short again.
    limit: sized + options.details.amount,
    network,
    purpose: "session top-up",
    token: options.details.token,
  });

  const { additionalDeposit, transaction } = await buildTopUpTransaction({
    additionalDeposit: sized,
    balance: spendableAmount(capacity),
    details: options.details,
    identity: options.identity,
    record: options.record,
    required,
  });
  const deposit = options.record.deposit + additionalDeposit;
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

/**
 * Signs the top-up transaction. A top-up whose fee the payer pays in the session token itself
 * (no fee sponsor) is lowered so the deposit and the fee fit the balance together, never below
 * `required`; a fee the prepared transaction does not price lowers it to `required`.
 */
async function buildTopUpTransaction(options: {
  additionalDeposit: bigint;
  balance: bigint;
  details: SessionDetails;
  identity: PaymentIdentity;
  record: PersistedSessionRecord;
  required: bigint;
}) {
  const request = (additionalDeposit: bigint) =>
    buildTopUpTransactionRequest({
      additionalDeposit,
      details: options.details,
      record: options.record,
    });
  const client = options.identity.getClient({ chainId: options.details.chainId });
  const prepared = (await prepareTransactionRequest(
    client as never,
    {
      account: (client as { account: unknown }).account,
      ...request(options.additionalDeposit),
    } as never,
  )) as Record<string, unknown> & { gas?: bigint };
  prepared.gas = (prepared.gas ?? 0n) + 5_000n;
  const additionalDeposit = feeFundedTopUp({
    additionalDeposit: options.additionalDeposit,
    balance: options.balance,
    details: options.details,
    prepared,
    required: options.required,
  });
  // The deposit only changes the calls' arguments, not the gas the prepared transaction priced.
  if (additionalDeposit !== options.additionalDeposit)
    prepared.calls = request(additionalDeposit).calls;
  return {
    additionalDeposit,
    transaction: (await signTransaction(client as never, prepared as never)) as `0x${string}`,
  };
}

/** Gas prices are in attodollars (10^-18 USD); fee tokens charge in 10^-6 USD base units. */
const attodollarsPerFeeUnit = 10n ** 12n;

/**
 * The top-up `additionalDeposit` lowered so that it and the transaction's fee fit `balance` (the
 * balance capped by the key's remaining limit) when the payer pays the fee in the session token,
 * never below `required`. A sponsored top-up, or one
 * whose fee another token pays, keeps its amount. A fee `prepared` does not price lowers the
 * top-up to `required`.
 */
export function feeFundedTopUp(options: {
  additionalDeposit: bigint;
  balance: bigint;
  details: Pick<SessionDetails, "feePayer" | "token"> & Partial<Pick<SessionDetails, "feeToken">>;
  prepared: { gas?: unknown; gasPrice?: unknown; maxFeePerGas?: unknown };
  required: bigint;
}) {
  if (options.additionalDeposit <= options.required || options.details.feePayer)
    return options.additionalDeposit;
  const feeToken = options.details.feeToken ?? options.details.token;
  if (feeToken.toLowerCase() !== options.details.token.toLowerCase())
    return options.additionalDeposit;
  const { gas } = options.prepared;
  const price = options.prepared.maxFeePerGas ?? options.prepared.gasPrice;
  if (typeof gas !== "bigint" || typeof price !== "bigint") return options.required;
  const fee = (gas * price + attodollarsPerFeeUnit - 1n) / attodollarsPerFeeUnit;
  const room = options.balance > fee ? options.balance - fee : 0n;
  if (options.additionalDeposit <= room) return options.additionalDeposit;
  return room > options.required ? room : options.required;
}

export function buildTopUpTransactionRequest(options: {
  additionalDeposit: bigint;
  details: Pick<SessionDetails, "feePayer" | "token"> & Partial<Pick<SessionDetails, "feeToken">>;
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
    feeToken: options.details.feeToken ?? options.details.token,
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
 * The amount a top-up adds to a session's deposit: at least `required`, the shortfall the server
 * or the voucher names, and otherwise the largest of the server's `suggestedDeposit` and a chunk
 * of the spending cap (the cap's whole headroom when it was set explicitly, else the current
 * deposit, so the deposit doubles). Topping up by the bare shortfall costs one transaction per
 * call once a session's deposit is used up. The chunk never lifts the deposit above the cap or
 * spends more than `available`, the payer's balance within its key's remaining limit.
 */
export function topUpAmount(options: {
  available?: bigint | undefined;
  cap: bigint;
  deposit: bigint;
  explicitCap: boolean;
  required: bigint;
  suggestedDeposit?: bigint | undefined;
}) {
  const headroom = options.cap > options.deposit ? options.cap - options.deposit : 0n;
  const chunk = options.explicitCap ? headroom : options.deposit;
  let amount = [options.required, options.suggestedDeposit ?? 0n, chunk].reduce((max, value) =>
    value > max ? value : max,
  );
  if (amount > headroom) amount = headroom;
  if (options.available !== undefined && amount > options.available) amount = options.available;
  return amount > options.required ? amount : options.required;
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
