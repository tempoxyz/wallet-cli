import { formatUnits } from "viem";

import { networkFields, type Network } from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { knownToken } from "../shared/tokens.js";
import { decodeBase64UrlJson, escapeInvisible, stringValue } from "../shared/utils.js";

/** What a paid request spent, as `--write-meta` reports it under `payment`. */
export type PaymentReceipt = ReturnType<typeof paymentReceipt>;

/**
 * The receipt of a paid request, built from what its payment already holds. Amounts are in token
 * units, as `--max-spend` counts them; `symbol` and `decimals` are known only for listed tokens.
 * The session fields are `null` for a charge. A newly opened session adds `instruction` and
 * `_next` naming the command that requests its close; rerun after the close grace period, it
 * withdraws the unspent deposit. A subscription authorizes `amount` every `subscription.period`
 * until `subscription.expires` rather than paying it once. Strings the server chose are shown
 * with visible escapes.
 */
export function paymentReceipt(payment: {
  intent: string;
  /** Raw amount of `token` this request paid, or a subscription authorizes per period. */
  amount: bigint;
  /** The token the payment debits: MACH for a MACH settlement. */
  token: string;
  network: Network;
  payer: string;
  txHash: string | null;
  /** The channel a session payment used, its raw deposit, and its raw cumulative voucher. */
  session?: { channelId: string; deposit: bigint; cumulative: bigint; reused: boolean } | undefined;
  /** A subscription's billing period (e.g. `1 week`) and when its authorization expires. */
  subscription?: { period: string; expires: string } | undefined;
}) {
  const { network, session, subscription } = payment;
  const listed = knownToken(payment.token, network.chainId);
  const token = escapeInvisible(payment.token.toLowerCase());
  const channelId = session ? escapeInvisible(session.channelId) : null;
  const deposit = session ? tokenUnits(session.deposit) : null;
  return {
    intent: escapeInvisible(payment.intent),
    amount: tokenUnits(payment.amount),
    token,
    symbol: listed?.symbol ?? null,
    decimals: listed?.decimals ?? null,
    tx_hash: payment.txHash,
    session: session ? (session.reused ? ("reuse" as const) : ("open" as const)) : null,
    channel_id: channelId,
    deposit_locked: deposit,
    cumulative: session ? tokenUnits(session.cumulative) : null,
    subscription: subscription
      ? {
          period: escapeInvisible(subscription.period),
          expires: escapeInvisible(subscription.expires),
        }
      : null,
    payer: payment.payer,
    ...networkFields(network.chainId),
    ...(session && !session.reused && channelId
      ? nextStep(
          `Session ${channelId} keeps ${deposit} ${listed?.symbol ?? token} locked until it is closed. When you are done with this service, run the next command to request its close, then follow that command's _next to withdraw the unspent deposit once the close grace period ends.`,
          ["wallet", "sessions", "close", channelId],
          { network },
        )
      : {}),
  };
}

/** The stderr summary of `receipt`: one line, plus the close command for a new session. */
export function receiptSummary(receipt: PaymentReceipt) {
  const label = receipt.symbol ?? receipt.token;
  if (receipt.subscription)
    return `Authorized a subscription of up to ${receipt.amount} ${label} every ${receipt.subscription.period} until ${receipt.subscription.expires}\n`;
  const paid = `Paid ${receipt.amount} ${label}`;
  if (receipt._next)
    return `${paid} · opened a session with ${receipt.deposit_locked} ${label} locked\nWhen done, request its close, then rerun after the grace period to withdraw the unspent deposit: ${receipt._next.command}\n`;
  if (receipt.session === "reuse")
    return `${paid} · session ${receipt.channel_id} (${receipt.cumulative} of ${receipt.deposit_locked} ${label} deposit in signed vouchers)\n`;
  return `${paid}${receipt.tx_hash ? ` · tx ${receipt.tx_hash}` : ""}\n`;
}

/**
 * The transaction hash in a paid response's successful Tempo Payment-Receipt: a charge's or
 * subscription's `reference`, or, given the paid session's `channelId`, the `txHash` of a session
 * receipt for that channel (its `reference` names the channel). Only a 32-byte hex hash is kept.
 */
export function receiptTxHash(response: Response, channelId?: string) {
  const header = response.headers.get("payment-receipt");
  if (!header) return null;
  try {
    const receipt = decodeBase64UrlJson(header);
    if (receipt.method !== "tempo" || receipt.status !== "success") return null;
    if (channelId === undefined) return transactionHash(receipt.reference);
    const sameChannel = stringValue(receipt.channelId).toLowerCase() === channelId.toLowerCase();
    return receipt.intent === "session" && sameChannel ? transactionHash(receipt.txHash) : null;
  } catch {
    return null;
  }
}

/** `value` when it is a 32-byte hex transaction hash, else `null`. */
export function transactionHash(value: unknown) {
  const hash = stringValue(value);
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? hash : null;
}

function tokenUnits(value: bigint) {
  return formatUnits(value, 6);
}
