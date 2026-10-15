import { Credential } from "mppx";
import { fetch as undiciFetch } from "undici";

import type { PaymentReceipt } from "../payment/receipt.js";
import { paymentOutcomeUnknownError } from "../shared/errors.js";
import { escapeInvisible } from "../shared/utils.js";
import { type FetchPlan, fetchWithRedirects } from "./fetch.js";
import type { RequestOptions } from "./options.js";

// Credentials may authorize payment even when the response never arrives. Never
// include the credential itself (or transport error text that might echo it).
export async function fetchPaidRequest(
  request: FetchPlan,
  options: RequestOptions,
  credential: string,
  fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
) {
  const reference = paymentRecoveryReference(credential);
  try {
    const { response } = await fetchWithRedirects(request, options, fetchImpl, true);
    paymentReferences.set(response, reference);
    return response;
  } catch {
    throw paymentOutcomeUnknownError(
      `A payment credential was sent or attempted, but no final response was received; payment may have completed.${reference} Check with the provider before creating another payment.`,
    );
  }
}

export const paymentReferences = new WeakMap<Response, string>();
export const paidResponseFailures = new WeakSet<Response>();
/** What the payment behind each paid response spent; reported once the response succeeds. */
export const paymentReceipts = new WeakMap<Response, PaymentReceipt>();

function paymentRecoveryReference(credential: string) {
  let reference = "";
  try {
    const parsed = Credential.deserialize<Record<string, unknown>>(credential);
    reference = ` Challenge ID: ${recoveryReferenceValue(parsed.challenge.id)}. Intent: ${recoveryReferenceValue(parsed.challenge.intent)}.`;
    const hash = parsed.payload.hash;
    if (
      parsed.payload.type === "hash" &&
      typeof hash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(hash)
    )
      reference += ` Transaction hash: ${hash}.`;
    const channelId = parsed.payload.channelId;
    if (typeof channelId === "string" && /^0x[0-9a-fA-F]{64}$/.test(channelId))
      reference += ` Channel ID: ${channelId}.`;
  } catch {
    // Recovery hints must never replace the original outcome classification.
  }
  return reference;
}

function recoveryReferenceValue(value: unknown) {
  return escapeInvisible(JSON.stringify(String(value).slice(0, 200)));
}
