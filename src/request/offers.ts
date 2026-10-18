import { mppxRequirement } from "machine-fetch/adapters/mppx";
import type { PaymentRequirement } from "machine-fetch/interfaces";
import { Challenge } from "mppx";
import { Transport } from "mppx/client";
import { Header as X402Header, Types as X402 } from "mppx/x402";
import { isAddress } from "viem";

import { type Destination, destinations } from "../shared/chains.js";
import { escapeInvisible, getRecord, stringValue } from "../shared/utils.js";
import { requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";

/**
 * A payable EVM offer (Phase 3): a native MPP `evm` charge or an x402 `exact` payment, on a chain in
 * the destination table and in that chain's USDC. Server-supplied fields never add a chain or a
 * token: an offer anywhere else is refused, with the reason in `refused`.
 */
export type EvmOffer = {
  kind: "mpp" | "x402";
  /** The offer as Mppx parses it; x402 offers are Mppx's synthesized challenges. */
  challenge: Challenge.Challenge;
  destination: Destination;
  requirement: PaymentRequirement;
  /** A 402 response carrying exactly this offer, for credential creation. */
  response: Response;
};

/** The EVM offers in a 402, and why each other EVM or x402 offer cannot be paid. */
export function evmOffers(response: Response, options: RequestOptions) {
  const table = destinations(requestNetwork(options).chainId);
  const offers: EvmOffer[] = [];
  const refused: string[] = [];
  let challenges: Challenge.Challenge[];
  try {
    challenges = Transport.http().getChallenges(response) as Challenge.Challenge[];
  } catch {
    return { offers, refused: ["the payment challenges are malformed"] };
  }
  for (const challenge of challenges) {
    if (challenge.method !== X402.paymentMethod || challenge.intent !== "charge") continue;
    const kind = challenge.id.startsWith(X402.syntheticChallengeIdPrefix) ? "x402" : "mpp";
    const refuse = (reason: string) => refused.push(`${kind} offer: ${reason}`);
    let requirement: PaymentRequirement;
    try {
      requirement = mppxRequirement(challenge);
    } catch (error) {
      refuse(error instanceof Error ? error.message : "malformed");
      continue;
    }
    if (kind === "x402" && requirement.method !== "exact") {
      refuse(`unsupported x402 scheme ${escapeInvisible(requirement.method)}`);
      continue;
    }
    const destination = table.find((entry) => entry.network === requirement.network);
    if (!destination) {
      refuse(`${escapeInvisible(requirement.network)} is not a chain the CLI pays on`);
      continue;
    }
    if (requirement.asset.toLowerCase() !== destination.usdc.address.toLowerCase()) {
      refuse(`${escapeInvisible(requirement.asset)} is not USDC on ${destination.name}`);
      continue;
    }
    // x402 signs the EIP-3009 domain the server names; only the token's own domain is signed.
    const extra = getRecord(getRecord(requirement.metadata).extra);
    if (
      kind === "x402" &&
      (extra.name !== destination.usdc.name || extra.version !== destination.usdc.version)
    ) {
      refuse(`its EIP-3009 domain is not ${destination.name} USDC's`);
      continue;
    }
    if (!requirement.recipient || !isAddress(requirement.recipient, { strict: false })) {
      refuse("missing a valid recipient address");
      continue;
    }
    if (
      challenge.expires &&
      (!Number.isFinite(Date.parse(challenge.expires)) ||
        Date.parse(challenge.expires) <= Date.now())
    ) {
      refuse("expired or has an invalid expiry");
      continue;
    }
    offers.push({
      kind,
      challenge,
      destination,
      requirement,
      response: offerResponse(response, challenge, kind),
    });
  }
  return { offers, refused };
}

/** Whether a 402 offers a Tempo payment the existing Tempo path can consider. */
export function offersTempo(response: Response) {
  const header = response.headers.get("www-authenticate");
  if (!header) return false;
  try {
    return Challenge.deserializeList(header).some((challenge) => challenge.method === "tempo");
  } catch {
    return false;
  }
}

/** A 402 carrying only `challenge`, in the wire format it was offered in. */
function offerResponse(response: Response, challenge: Challenge.Challenge, kind: "mpp" | "x402") {
  const headers = new Headers();
  if (kind === "mpp") headers.set("www-authenticate", Challenge.serialize(challenge));
  else {
    const envelope = X402Header.decodePaymentRequiredEnvelope(
      response.headers.get(X402.paymentRequiredHeader) ?? "",
    );
    const index = Number(challenge.id.slice(X402.syntheticChallengeIdPrefix.length));
    headers.set(
      X402.paymentRequiredHeader,
      X402Header.encodePaymentRequired({
        ...envelope,
        accepts: [envelope.accepts[index]],
      } as never),
    );
  }
  return new Response(null, { status: 402, headers });
}

/** The header a credential for `offer` is sent in. */
export function credentialHeader(offer: Pick<EvmOffer, "kind">) {
  return offer.kind === "x402" ? X402.paymentSignatureHeader : "authorization";
}
