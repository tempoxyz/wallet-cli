import { Challenge, Constants } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { isAddress } from "viem";
import { Channel as TempoChannel } from "viem/tempo";

import { originFromUrl } from "../payment/session-store.js";
import { paymentError, usageError } from "../shared/errors.js";
import { escrowContract } from "../shared/network.js";
import { escapeInvisible, getRecord, stringValue } from "../shared/utils.js";
import { requestNetwork } from "./identity.js";
import { isMachPaymentToken, type MachService, machNotAcceptedError, machService } from "./mach.js";
import type { RequestOptions } from "./options.js";
import { enforceMaxSpend } from "./spend.js";

/**
 * Pass exactly the validated offer to mppx. Observation hooks cannot reject payment. `service`
 * names the service, and how to retry it, when it does not accept MACH; the request URL's host
 * unless given.
 */
export function preparePaymentChallenge(
  response: Response,
  options: RequestOptions,
  requestUrl: string,
  service = machService(options, requestUrl),
) {
  const selected = selectPaymentTokenResponse(response, options.paymentToken, service);
  const header = selected.headers.get("www-authenticate");
  const error = paymentChallengeError(header);
  if (error) throw error;
  let challenges: Challenge.Challenge[];
  try {
    challenges = Challenge.deserializeList(header!);
  } catch {
    throw paymentError("Malformed payment challenge");
  }
  const expectedChain = requestNetwork(options).chainId;
  const networkChallenges = challenges.filter(
    (offer) => paymentChallengeChainId(offer, options) === expectedChain,
  );
  // Prefer offers on the selected network before applying intent preference.
  // Keep mismatched offers when none match so the network diagnostic remains explicit.
  if (networkChallenges.length > 0) challenges = networkChallenges;
  const session =
    options.paymentIntent !== "charge"
      ? sessionChallengeFromHeader(challenges.map(Challenge.serialize).join(", "))
      : undefined;
  const challenge =
    session ??
    challenges.find(
      (offer) =>
        offer.method === "tempo" &&
        (offer.intent === "charge" ||
          (options.paymentIntent === "auto" && offer.intent === "subscription")),
    );
  if (!challenge || (options.paymentIntent === "session" && !session))
    throw paymentError("Server did not offer a compatible payment intent");
  const details = getRecord(challenge.request.methodDetails);
  const offeredChain = paymentChallengeChainId(challenge, options);
  if (offeredChain !== expectedChain)
    throw paymentError(
      `Payment network mismatch: expected chain ${expectedChain}, received ${escapeInvisible(String(offeredChain))}`,
    );
  if (challenge.intent === "subscription" && options.maxSpend !== undefined)
    throw paymentError(
      "--max-spend cannot enforce cumulative spending for recurring subscriptions; choose a charge or session offer",
    );
  if (
    challenge.expires &&
    (!Number.isFinite(Date.parse(challenge.expires)) || Date.parse(challenge.expires) <= Date.now())
  )
    throw paymentError("Payment challenge is expired or has an invalid expiry");
  enforceMaxSpend(challenge, options);
  validatePaymentAddresses(challenge);
  const deployment = machineTokenDeployments[expectedChain as keyof typeof machineTokenDeployments];
  if (
    deployment &&
    stringValue(challenge.request.currency).toLowerCase() === deployment.token.toLowerCase()
  )
    throw paymentError(
      "MACH must be spent through a machine-enabled settlement-currency charge, not advertised as the payment currency",
    );
  if (isMachPaymentToken(options.paymentToken)) {
    if (options.maxSpend === undefined && !options.dryRun)
      throw usageError("MACH payments require --max-spend (or TEMPO_MAX_SPEND)");
    if (challenge.intent !== "charge" || details.machineTokenEnabled !== true)
      throw machNotAcceptedError(service);
    if (Array.isArray(details.splits) && details.splits.length > 0)
      throw paymentError("MACH settlement does not support split charge offers");
  }
  if (challenge.intent === "session") sessionDetails(challenge, requestUrl, options);
  const headers = new Headers(selected.headers);
  headers.set("www-authenticate", Challenge.serialize(challenge));
  return { challenge, response: new Response(null, { status: selected.status, headers }) };
}

export function sessionDetails(
  challenge: Challenge.Challenge,
  requestUrl: string,
  options: RequestOptions,
) {
  const request = challenge.request as Record<string, unknown>;
  const methodDetails = getRecord(request.methodDetails);
  const resolvedChainId =
    typeof methodDetails.chainId === "number"
      ? methodDetails.chainId
      : requestNetwork(options).chainId;
  const amount = bigintField(request.amount, "amount");
  const token = stringValue(request.currency).toLowerCase();
  const payee = stringValue(request.recipient).toLowerCase();
  const sessionProtocol = stringValue(methodDetails.sessionProtocol) || "v1";
  if (!token) throw paymentError("Session challenge is missing currency");
  if (!payee) throw paymentError("Session challenge is missing recipient");
  if (sessionProtocol !== "v1" && sessionProtocol !== "v2")
    throw paymentError(`Unsupported Tempo session protocol: ${escapeInvisible(sessionProtocol)}`);

  const expectedEscrow =
    sessionProtocol === "v2" ? TempoChannel.address : escrowContract(resolvedChainId);
  for (const advertisedEscrow of [methodDetails.escrowContract, methodDetails.escrow]) {
    const address = stringValue(advertisedEscrow);
    if (address && address.toLowerCase() !== expectedEscrow.toLowerCase())
      throw paymentError(
        `Unsupported Tempo session escrow: expected ${expectedEscrow}, received ${escapeInvisible(address)}`,
      );
  }

  return {
    amount,
    chainId: resolvedChainId,
    escrowContract: expectedEscrow.toLowerCase(),
    feePayer: Boolean(methodDetails.feePayer),
    origin: originFromUrl(requestUrl),
    payee,
    requestUrl,
    sessionProtocol,
    suggestedDeposit:
      typeof request.suggestedDeposit === "string" && /^\d+$/.test(request.suggestedDeposit)
        ? BigInt(request.suggestedDeposit)
        : undefined,
    token,
  };
}

export type SessionDetails = ReturnType<typeof sessionDetails>;

export function sessionChallengeFromHeader(header: string | null) {
  if (!header) return undefined;
  try {
    return Challenge.deserializeList(header).find(
      (challenge) =>
        challenge.method === "tempo" &&
        challenge.intent === "session" &&
        Constants.getMethodDetail(
          challenge.request.methodDetails,
          Constants.MethodDetailKeys.sessionProtocol,
        ) === Constants.SessionProtocols.v2,
    );
  } catch {
    return undefined;
  }
}

export function chargeChallengeFromHeader(
  header: string | null,
  sessionChallenge: Challenge.Challenge,
  options: RequestOptions,
) {
  if (!header) return undefined;
  try {
    const sessionRequest = sessionChallenge.request as Record<string, unknown>;
    const sessionMethodDetails = getRecord(sessionRequest.methodDetails);
    const sessionChainId = normalizedChallengeChainId(sessionMethodDetails, options);
    const sessionCurrency = stringValue(sessionRequest.currency).toLowerCase();
    const sessionRecipient = stringValue(sessionRequest.recipient).toLowerCase();
    return Challenge.deserializeList(header)
      .filter((challenge) => {
        if (challenge.method !== "tempo" || challenge.intent !== "charge") return false;
        const request = challenge.request as Record<string, unknown>;
        const methodDetails = getRecord(request.methodDetails);
        return (
          normalizedChallengeChainId(methodDetails, options) === sessionChainId &&
          stringValue(request.currency).toLowerCase() === sessionCurrency &&
          stringValue(request.recipient).toLowerCase() === sessionRecipient
        );
      })
      .sort((left, right) => {
        const leftAmount = challengeAmount(left);
        const rightAmount = challengeAmount(right);
        return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
      })[0];
  } catch {
    return undefined;
  }
}

export function normalizedChallengeChainId(
  methodDetails: Record<string, unknown>,
  options: RequestOptions,
) {
  return typeof methodDetails.chainId === "number"
    ? methodDetails.chainId
    : requestNetwork(options).chainId;
}

function paymentChallengeChainId(challenge: Challenge.Challenge, options: RequestOptions) {
  return (
    getRecord(challenge.request.methodDetails).chainId ??
    (challenge.intent === "subscription" ? 42431 : requestNetwork(options).chainId)
  );
}

export function challengeAmount(challenge: Challenge.Challenge) {
  const amount = (challenge.request as Record<string, unknown>).amount;
  if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  throw paymentError("Charge challenge is missing amount");
}

function bigintField(value: unknown, name: string) {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw paymentError(`Session challenge is missing ${name}`);
}

function offeredTempoCurrencies(header: string | null) {
  if (!header) return [];
  try {
    return [
      ...new Set(
        Challenge.deserializeList(header).flatMap((challenge) => {
          if (challenge.method !== "tempo") return [];
          const request = challenge.request as Record<string, unknown>;
          const currency = stringValue(request.currency).toLowerCase();
          return currency ? [currency] : [];
        }),
      ),
    ];
  } catch {
    return [];
  }
}

export function tempoPaymentChallengeResponse(response: Response) {
  if (!response.headers.has("www-authenticate") || !response.headers.has("payment-required"))
    return response;

  const headers = new Headers(response.headers);
  headers.delete("payment-required");
  return new Response(null, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/** `service` names the service when it offers no machine-enabled charge for MACH. */
export function selectPaymentTokenResponse(
  response: Response,
  token: string | undefined,
  service: MachService = { host: "The service", retry: "Retry without --mach." },
) {
  if (!token) return response;
  const header = response.headers.get("www-authenticate");
  if (!header) return response;

  let challenges: Challenge.Challenge[];
  try {
    challenges = Challenge.deserializeList(header).filter((challenge) => {
      if (challenge.method !== "tempo") return false;
      const request = challenge.request as Record<string, unknown>;
      if (isMachPaymentToken(token))
        return (
          challenge.intent === "charge" &&
          getRecord(request.methodDetails).machineTokenEnabled === true
        );
      return stringValue(request.currency).toLowerCase() === token.toLowerCase();
    });
  } catch {
    return response;
  }

  if (challenges.length === 0) {
    if (isMachPaymentToken(token)) throw machNotAcceptedError(service);
    const available = offeredTempoCurrencies(header).map(escapeInvisible);
    throw paymentError(
      `Server did not offer payment token ${token}.${available.length > 0 ? ` Available tokens: ${available.join(", ")}.` : ""}`,
    );
  }

  const headers = new Headers(response.headers);
  headers.set(
    "www-authenticate",
    challenges.map((challenge) => Challenge.serialize(challenge)).join(", "),
  );
  return new Response(null, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function paymentChallengeError(header: string | null) {
  if (!header)
    return paymentError("Payment required but response is missing WWW-Authenticate header");
  if (!/(^|,)\s*Payment\s/i.test(header))
    return paymentError("Unsupported or malformed payment challenge in WWW-Authenticate header");
  if (!/method="?tempo"?/i.test(header))
    return paymentError("Unsupported payment method in WWW-Authenticate header");
  return undefined;
}

function validatePaymentAddresses(challenge: Challenge.Challenge) {
  const request = challenge.request as Record<string, unknown>;
  if (!isAddress(stringValue(request.currency)))
    throw paymentError("Payment challenge is missing a valid currency address");
  const isProof = challenge.intent === "charge" && BigInt(request.amount as string) === 0n;
  if (!isProof && !isAddress(stringValue(request.recipient)))
    throw paymentError("Payment challenge is missing a valid recipient address");
}
