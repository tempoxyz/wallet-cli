import { formatUnits } from "viem";

import { networkFields, type Network } from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { knownToken } from "../shared/tokens.js";
import { decodeBase64UrlJson, escapeInvisible, getRecord, stringValue } from "../shared/utils.js";

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
  /** How the payment acquired `token`: a swap's route, its input token, and the most it spent. */
  funding?: { route: string; input: { token: string; maxAmount: bigint } } | undefined;
  /** The chain paid on when it is not `network`'s Tempo chain, such as Base. */
  chain?: { chainId: number; name: string } | undefined;
  /** `token`'s listing on `chain`, which the Tempo token list does not cover. */
  listed?: { symbol: string; decimals: number } | undefined;
}) {
  const { network, session, subscription, funding, chain } = payment;
  const listed = payment.listed ?? knownToken(payment.token, network.chainId);
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
    payer: payment.payer.toLowerCase(),
    ...(funding
      ? {
          funding: {
            route: escapeInvisible(funding.route),
            input: {
              token: escapeInvisible(funding.input.token.toLowerCase()),
              symbol: knownToken(funding.input.token, network.chainId)?.symbol ?? null,
              max_amount: tokenUnits(funding.input.maxAmount),
            },
          },
        }
      : {}),
    ...(chain ? { chain_id: chain.chainId, network: chain.name } : networkFields(network.chainId)),
    ...(session && !session.reused && channelId
      ? nextStep(
          `Session ${channelId} keeps ${deposit} ${listed?.symbol ?? token} locked until it is closed. When you are done with this service, run the next command to request its close, then follow that command's _next to withdraw the unspent deposit once the close grace period ends.`,
          ["wallet", "sessions", "close", channelId],
          { network },
        )
      : {}),
  };
}

/**
 * The stderr summary of `receipt`: one line, plus the close command for a new session. A
 * subscription whose receipt names a transaction paid its first period on activation, so the line
 * reports that payment as well as the recurring authorization.
 */
export function receiptSummary(receipt: PaymentReceipt) {
  const label = receipt.symbol ?? receipt.token;
  const paid = `Paid ${receipt.amount} ${label}`;
  if (receipt.subscription) {
    const terms = `up to ${receipt.amount} ${label} every ${receipt.subscription.period} until ${receipt.subscription.expires}`;
    return receipt.tx_hash
      ? `${paid} for the first period · tx ${receipt.tx_hash} · authorized ${terms}\n`
      : `Authorized a subscription of ${terms}\n`;
  }
  if (receipt._next)
    return `${paid} · opened a session with ${receipt.deposit_locked} ${label} locked\nWhen done, request its close, then rerun after the grace period to withdraw the unspent deposit: ${receipt._next.command}\n`;
  if (receipt.session === "reuse")
    return `${paid} · session ${receipt.channel_id} (${receipt.cumulative} of ${receipt.deposit_locked} ${label} deposit in signed vouchers)\n`;
  const swapped = receipt.funding
    ? ` · bought with up to ${receipt.funding.input.max_amount} ${receipt.funding.input.symbol ?? receipt.funding.input.token} on the Tempo DEX`
    : "";
  return `${paid}${swapped}${receipt.tx_hash ? ` · tx ${receipt.tx_hash}` : ""}\n`;
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

/**
 * The settlement transaction a paid EVM charge's response names, or `null`: x402's
 * `payment-response` header (`x-payment-response` before v2) when it reports success on one of
 * `networks`, else an MPP `payment-receipt` for the `evm` method. x402 encodes the header in
 * standard base64.
 */
export function evmReceiptTxHash(response: Response, networks: readonly string[]) {
  for (const name of ["payment-response", "x-payment-response"]) {
    const header = response.headers.get(name);
    if (!header) continue;
    try {
      const settled = getRecord(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
      const network = stringValue(settled.network).toLowerCase();
      if (settled.success === true && (!network || networks.includes(network)))
        return transactionHash(settled.transaction);
    } catch {}
    return null;
  }
  const header = response.headers.get("payment-receipt");
  if (!header) return null;
  try {
    const receipt = decodeBase64UrlJson(header);
    if (receipt.method !== "evm" || receipt.status !== "success") return null;
    return transactionHash(receipt.reference);
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
