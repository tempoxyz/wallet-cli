import { Errors } from "incur";
import { type Challenge, Credential, PaymentRequest } from "mppx";
import { Mppx, session as tempoSession } from "mppx/client";
import { parseUnits } from "viem";
import { Abis as TempoAbis, Actions, Channel as TempoChannel } from "viem/tempo";

import { paymentReceipt, receiptTxHash } from "../payment/receipt.js";
import { requireSessionDescriptor } from "../payment/session-descriptor.js";
import {
  deleteSessionRecord,
  findReusableSessions,
  type PersistedSessionRecord,
  preserveSessionCumulative,
  upsertSessionRecord,
} from "../payment/session-store.js";
import { escrowAbi } from "../shared/constants.js";
import { paymentError } from "../shared/errors.js";
import { createTempoPublicClient, networkName } from "../shared/network.js";
import {
  getRecord,
  nowSeconds,
  parseOnChainBigInt,
  sanitizeText,
  stringValue,
} from "../shared/utils.js";
import { sessionDetails, type SessionDetails, tempoPaymentChallengeResponse } from "./challenge.js";
import { cloneRequestInit, type FetchPlan } from "./fetch.js";
import { type PaymentIdentity, requestNetwork, resolvePaymentIdentity } from "./identity.js";
import type { RequestOptions } from "./options.js";
import { fetchPaidRequest, paidResponseFailures, paymentReceipts } from "./paid.js";
import { persistSessionReceipt, sessionShortfall, tryTopUpAndRetry } from "./session-topup.js";
import { assertWithinMaxSpend, formatTokenAmount, spendCap } from "./spend.js";

type RpcOptions = Parameters<typeof createTempoPublicClient>[1];

// Dry-run reads only inform the quote, so a stalled RPC must not hold it up.
export const dryRunRpc = { timeout: 3_000, retryCount: 0 };

export async function paySessionAndRetryRequest(
  paymentRequiredResponse: Response,
  request: FetchPlan,
  options: RequestOptions,
  challenge: Challenge.Challenge,
  skipChannelId?: string | undefined,
) {
  try {
    const details = sessionDetails(challenge, request.url, options);
    const identity = await resolvePaymentIdentity(options);
    const { reusable, depositRaw, signedCumulative } = await planSessionPayment(
      details,
      identity,
      options,
      { skipChannelId },
    );
    const challengeResponse = tempoPaymentChallengeResponse(paymentRequiredResponse);
    const payment = Mppx.create({
      methods: [
        tempoSession({
          ...identity.methodOptions,
          getClient: identity.getClient,
          maxDeposit: spendCap(options),
        }),
      ],
      polyfill: false,
    });

    let credential: string;
    let record: PersistedSessionRecord | undefined;

    if (reusable) {
      assertWithinMaxSpend(signedCumulative, options);
      await preserveSessionCumulative(reusable.channel_id, signedCumulative);
      credential = await payment.createCredential(challengeResponse, {
        action: "voucher",
        channelId: reusable.channel_id as `0x${string}`,
        cumulativeAmountRaw: signedCumulative.toString(),
        ...(reusable.descriptor_json ? { descriptor: requireSessionDescriptor(reusable) } : {}),
      });
      record = reusable;
    } else {
      await assertSufficientSessionBalance(identity.address, details, depositRaw);
      assertWithinMaxSpend(signedCumulative, options);
      credential = await payment.createCredential(challengeResponse, {
        depositRaw: depositRaw.toString(),
      });
      record = sessionRecordFromOpenCredential({
        challenge,
        credential,
        depositRaw,
        details,
        identity,
        signedCumulative,
      });
      await upsertSessionRecord(record);
    }

    const paidInit = payment.transport.setCredential(cloneRequestInit(request.init), credential);
    const response = await fetchPaidRequest(
      { init: paidInit, url: request.url },
      options,
      credential,
    );
    if (reusable && response.status === 402) {
      const recovered = await tryTopUpAndRetry({
        credential,
        details,
        identity,
        options,
        payment,
        paymentRequiredResponse,
        record: reusable,
        request,
        response,
        signedCumulative,
      });
      if (recovered) return recovered;
    }
    if (reusable && (await isSessionInvalidationResponse(response))) {
      try {
        await deleteSessionRecord(reusable.channel_id);
      } catch {
        paidResponseFailures.add(response);
        return response;
      }
      return paySessionAndRetryRequest(
        paymentRequiredResponse,
        request,
        options,
        challenge,
        reusable.channel_id,
      );
    }
    try {
      await persistSessionReceipt(response, record.channel_id, signedCumulative);
    } catch {
      paidResponseFailures.add(response);
    }
    paymentReceipts.set(
      response,
      paymentReceipt({
        intent: challenge.intent,
        amount: details.amount,
        token: details.token,
        network: requestNetwork(options),
        payer: identity.address,
        txHash: receiptTxHash(response, record.channel_id),
        session: {
          channelId: record.channel_id,
          deposit: record.deposit,
          cumulative: signedCumulative,
          reused: reusable !== undefined,
        },
      }),
    );
    return response;
  } catch (error) {
    if (error instanceof Errors.IncurError) throw error;
    throw paymentError(sanitizeText(error instanceof Error ? error.message : String(error)));
  }
}

type SessionPayer = Pick<PaymentIdentity, "address" | "signerAddress">;

type SessionPlanOptions = {
  /** Decide as a payment does, but keep stale records for the payment to delete and bound RPC reads. */
  dryRun?: boolean | undefined;
  /** A channel the server just invalidated. */
  skipChannelId?: string | undefined;
};

/**
 * How a session payment proceeds, shared by payments and dry runs: a voucher on a reusable stored
 * channel, or a new channel locking `depositRaw`. On reuse, `depositRaw` is the top-up the
 * payment sends if the server rejects a voucher beyond the on-chain deposit. `signedCumulative`
 * is the voucher amount the spending cap bounds.
 */
export async function planSessionPayment(
  details: SessionDetails,
  identity: SessionPayer,
  options: RequestOptions,
  plan: SessionPlanOptions = {},
) {
  const reusable = await reusableSessionRecord(details, identity, plan);
  if (reusable) {
    const signedCumulative =
      maxBigInt(reusable.cumulative_amount, reusable.accepted_cumulative, reusable.server_spent) +
      details.amount;
    return {
      reusable,
      depositRaw: sessionShortfall(reusable, signedCumulative),
      signedCumulative,
    };
  }
  return {
    reusable: undefined,
    depositRaw: sessionDepositRaw(details, options),
    signedCumulative: details.amount,
  };
}

async function reusableSessionRecord(
  details: SessionDetails,
  identity: SessionPayer,
  plan: SessionPlanOptions,
): Promise<PersistedSessionRecord | undefined> {
  const discard = async (record: PersistedSessionRecord) => {
    if (!plan.dryRun) await deleteSessionRecord(record.channel_id);
  };
  const records = await findReusableSessions({
    authorizedSigner: identity.signerAddress,
    chainId: details.chainId,
    escrowContract: details.escrowContract,
    origin: details.origin,
    payee: details.payee,
    payer: identity.address,
    token: details.token,
  });
  for (const record of records) {
    if (plan.skipChannelId && record.channel_id.toLowerCase() === plan.skipChannelId.toLowerCase())
      return undefined;
    // A v2 record without its descriptor can never sign a voucher; try the next one.
    if (
      record.escrow_contract.toLowerCase() === TempoChannel.address.toLowerCase() &&
      !record.descriptor_json
    ) {
      await discard(record);
      continue;
    }

    const onChain = await readOnChainChannel(record, plan.dryRun ? dryRunRpc : {});
    if (
      !onChain ||
      onChain.closeRequestedAt !== 0n ||
      onChain.deposit <= onChain.settled ||
      onChain.payer.toLowerCase() !== identity.address.toLowerCase() ||
      onChain.payee.toLowerCase() !== details.payee ||
      onChain.token.toLowerCase() !== details.token ||
      onChain.authorizedSigner.toLowerCase() !== identity.signerAddress.toLowerCase()
    ) {
      await discard(record);
      return undefined;
    }
    // The stored deposit can lag the chain, e.g. when a top-up landed but its record update failed.
    return { ...record, deposit: onChain.deposit };
  }
  return undefined;
}

export async function isSessionInvalidationResponse(response: Response) {
  if (response.status !== 404 && response.status !== 410) return false;

  const authenticate = response.headers.get("www-authenticate")?.toLowerCase() ?? "";
  if (authenticate.includes("mpp") || authenticate.includes("payment")) return true;

  const body = await response
    .clone()
    .text()
    .catch(() => "");
  const text = body.toLowerCase();
  return (
    (text.includes("session") || text.includes("channel")) &&
    (text.includes("not found") ||
      text.includes("invalid") ||
      text.includes("expired") ||
      text.includes("closed"))
  );
}

/**
 * The deposit a new session locks: the server's suggestion, else an explicit cap, else the
 * per-call amount. Opening needs only a deposit that covers the per-call amount, so a deposit
 * above the spending cap is lowered to the cap.
 */
function sessionDepositRaw(details: SessionDetails, options: RequestOptions) {
  const maxSpend = parseUnits(spendCap(options), 6);
  const preferred =
    details.suggestedDeposit ?? (options.maxSpend === undefined ? details.amount : maxSpend);
  const deposit = preferred > maxSpend ? maxSpend : preferred;
  if (deposit < details.amount) throw paymentError("Session payment exceeds --max-spend");
  return deposit;
}

async function assertSufficientSessionBalance(
  payer: string,
  details: SessionDetails,
  depositRaw: bigint,
) {
  const client = createTempoPublicClient(details.chainId);
  const balance = (
    await Actions.token.getBalance(client as never, {
      account: payer as `0x${string}`,
      token: details.token as `0x${string}`,
    })
  ).amount;
  if (balance >= depositRaw) return;
  throw paymentError(
    `Insufficient balance for session deposit: available=${formatTokenAmount(balance)} required=${formatTokenAmount(depositRaw)}`,
  );
}

function sessionRecordFromOpenCredential(options: {
  challenge: Challenge.Challenge;
  credential: string;
  depositRaw: bigint;
  details: SessionDetails;
  identity: PaymentIdentity;
  signedCumulative: bigint;
}): PersistedSessionRecord {
  const parsed = Credential.deserialize<Record<string, unknown>>(options.credential);
  const payload = getRecord(parsed.payload);
  const channelId = stringValue(payload.channelId).toLowerCase();
  if (!channelId) throw paymentError("Session open credential did not include channelId");
  const now = nowSeconds();
  return {
    accepted_cumulative: 0n,
    authorized_signer: stringValue(
      payload.authorizedSigner || options.identity.signerAddress,
    ).toLowerCase(),
    chain_id: options.details.chainId,
    challenge_echo: challengeEchoJson(options.challenge),
    channel_id: channelId,
    close_requested_at: 0,
    created_at: now,
    cumulative_amount: options.signedCumulative,
    deposit: options.depositRaw,
    descriptor_json: payload.descriptor ? JSON.stringify(payload.descriptor) : undefined,
    escrow_contract: options.details.escrowContract,
    grace_ready_at: 0,
    last_used_at: now,
    network: networkName(options.details.chainId),
    origin: options.details.origin,
    payee: options.details.payee,
    payer: options.identity.address.toLowerCase(),
    request_url: options.details.requestUrl,
    salt: "0x00",
    server_spent: 0n,
    session_protocol: sessionProtocol(options.challenge) ?? (payload.descriptor ? "v2" : "v1"),
    state: "active",
    token: options.details.token,
  };
}

function sessionProtocol(challenge: Challenge.Challenge) {
  const request = challenge.request as Record<string, unknown>;
  const methodDetails = getRecord(request.methodDetails);
  return stringValue(methodDetails.sessionProtocol) || undefined;
}

async function readOnChainChannel(record: PersistedSessionRecord, rpc: RpcOptions = {}) {
  const client = createTempoPublicClient(record.chain_id, rpc);
  if (record.escrow_contract.toLowerCase() === TempoChannel.address.toLowerCase()) {
    const state = (await client.readContract({
      address: TempoChannel.address,
      abi: TempoAbis.tip20ChannelReserve,
      functionName: "getChannelState",
      args: [record.channel_id as `0x${string}`],
    })) as unknown;
    const object = getRecord(state);
    const tuple = Array.isArray(state) ? state : [];
    const deposit = parseOnChainBigInt(object.deposit ?? tuple[1]);
    const settled = parseOnChainBigInt(object.settled ?? tuple[0]);
    const closeRequestedAt = parseOnChainBigInt(object.closeRequestedAt ?? tuple[2]);
    if (deposit === 0n) return null;
    return {
      authorizedSigner: record.authorized_signer,
      closeRequestedAt,
      deposit,
      payee: record.payee,
      payer: record.payer,
      settled,
      token: record.token,
    };
  }

  const value = (await client.readContract({
    address: record.escrow_contract as `0x${string}`,
    abi: escrowAbi,
    functionName: "getChannel",
    args: [record.channel_id as `0x${string}`],
  })) as unknown;
  const object = getRecord(value);
  const tuple = Array.isArray(value) ? value : [];
  if (object.finalized ?? tuple[0]) return null;
  return {
    authorizedSigner: stringValue(object.authorizedSigner ?? tuple[5]),
    closeRequestedAt: parseOnChainBigInt(object.closeRequestedAt ?? tuple[1]),
    deposit: parseOnChainBigInt(object.deposit ?? tuple[6]),
    payee: stringValue(object.payee ?? tuple[3]),
    payer: stringValue(object.payer ?? tuple[2]),
    settled: parseOnChainBigInt(object.settled ?? tuple[7]),
    token: stringValue(object.token ?? tuple[4]),
  };
}

function challengeEchoJson(challenge: Challenge.Challenge) {
  return JSON.stringify({
    id: challenge.id,
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request: PaymentRequest.serialize(challenge.request),
    ...(challenge.expires ? { expires: challenge.expires } : {}),
    ...(challenge.digest ? { digest: challenge.digest } : {}),
    ...(challenge.opaque ? { opaque: challenge.opaque } : {}),
  });
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}
