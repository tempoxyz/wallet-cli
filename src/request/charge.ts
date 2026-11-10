import { Errors } from "incur";
import { Challenge, Credential } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { machineTokenDeployments } from "mppx/tempo";
import { formatUnits, parseUnits, type Address } from "viem";

import { paymentReceipt, receiptTxHash, transactionHash } from "../payment/receipt.js";
import { withSessionLock } from "../payment/session-lock.js";
import { paymentError } from "../shared/errors.js";
import { readTokenMetadata, tokenLabel, tokenMetadata } from "../shared/tokens.js";
import { getRecord, sanitizeText, stringValue } from "../shared/utils.js";
import { accessKeyLimitError } from "../wallet/access-key.js";
import {
  challengeAmount,
  chargeChallengeFromHeader,
  preparePaymentChallenge,
  selectPaymentTokenResponse,
  tempoPaymentChallengeResponse,
} from "./challenge.js";
import { cloneRequestInit, type FetchPlan } from "./fetch.js";
import {
  type PaymentIdentity,
  requestNetwork,
  resolvePaymentIdentity,
  writePrivateKeyNotice,
} from "./identity.js";
import {
  type ChargeParameters,
  isMachPaymentToken,
  isUnsimulatedMachRoute,
  machChargeParameters,
  type MachService,
  machService,
  runsMachRoute,
} from "./mach.js";
import type { RequestOptions } from "./options.js";
import { fetchPaidRequest, paymentReceipts } from "./paid.js";
import { createChargeCredential } from "./policy.js";
import { dryRunRpc, paySessionAndRetryRequest } from "./session.js";
import { formatTokenAmount, MaxSpendExceededError, spendCap } from "./spend.js";

export async function payAndRetryRequest(
  paymentRequiredResponse: Response,
  request: FetchPlan,
  options: RequestOptions,
  stderr: Pick<NodeJS.WriteStream, "write">,
) {
  const { challenge: selectedChallenge, response: selectedResponse } = preparePaymentChallenge(
    paymentRequiredResponse,
    options,
    request.url,
  );
  writePrivateKeyNotice(stderr, options);
  const header = selectPaymentTokenResponse(
    paymentRequiredResponse,
    options.paymentToken,
    machService(options, request.url),
  ).headers.get("www-authenticate");
  const challengeResponse = tempoPaymentChallengeResponse(selectedResponse);

  const sessionChallenge = selectedChallenge.intent === "session" ? selectedChallenge : undefined;
  if (options.paymentIntent !== "charge" && sessionChallenge) {
    let response: Response;
    try {
      response = await withSessionLock(request.url, () =>
        paySessionAndRetryRequest(selectedResponse, request, options, sessionChallenge),
      );
    } catch (error) {
      // A session refused by the cap still names a one-time charge within it.
      if (options.paymentIntent === "auto" && error instanceof MaxSpendExceededError)
        error.charge = chargeWithinCap(header, sessionChallenge, options);
      if (options.paymentIntent === "auto" && fallsBackToCharge(error))
        throw chargeFallbackError(header, sessionChallenge, options, error) ?? error;
      throw error;
    }
    return response;
  }

  if (options.paymentIntent === "session")
    throw paymentError("Server did not offer a compatible 'session' payment intent");

  // An explicit MACH charge whose swap route does not simulate tries the server's next
  // machine-enabled offer in another currency: the swapper buys each currency on the DEX, so one
  // book running dry need not block the payment. Nothing is signed or sent for a failed route.
  // At most `maxMachChargeOffers` offers are tried, since each failed route costs several RPC reads.
  const tried: Challenge.Challenge[] = [];
  let attempt = { challenge: selectedChallenge, response: challengeResponse };
  let firstError: unknown;
  for (;;) {
    try {
      return await payCharge(attempt.challenge, attempt.response, request, options);
    } catch (error) {
      if (!isMachPaymentToken(options.paymentToken) || !isUnsimulatedMachRoute(error)) throw error;
      firstError ??= error;
      tried.push(attempt.challenge);
      const next =
        tried.length < maxMachChargeOffers
          ? nextMachCharge(header, tried, selectedResponse, options, request.url)
          : undefined;
      if (!next) throw firstError;
      attempt = next;
    }
  }
}

/** How many machine-enabled charge offers, in distinct currencies, an explicit MACH charge tries. */
const maxMachChargeOffers = 3;

/**
 * The server's next machine-enabled charge offer that passes the same validation as the first,
 * ready to pay; undefined when none is left. An offer is skipped when a `tried` offer in its
 * settlement currency failed at the same or a smaller amount: the swapper needs at least as much
 * of that currency's book, so it would fail too. A cheaper one may still fit a thin book. Only an
 * offer to the first offer's recipient, for no more than its amount, is an alternative, so the
 * payment stays within what a `--dry-run` of the same 402 quoted.
 */
function nextMachCharge(
  header: string | null,
  tried: readonly Challenge.Challenge[],
  selectedResponse: Response,
  options: RequestOptions,
  requestUrl: string,
) {
  if (!header) return undefined;
  const currency = (challenge: Challenge.Challenge) =>
    stringValue(challenge.request.currency).toLowerCase();
  const amount = (challenge: Challenge.Challenge) => {
    try {
      return challengeAmount(challenge);
    } catch {
      return undefined;
    }
  };
  const failedAtOrBelow = (offer: Challenge.Challenge) => {
    const offered = amount(offer);
    return tried.some((failed) => {
      const failedAmount = amount(failed);
      return (
        currency(failed) === currency(offer) &&
        (offered === undefined || failedAmount === undefined || failedAmount <= offered)
      );
    });
  };
  // `tempo request` always signs pull-mode credentials, which the SDK refuses for an offer whose
  // supportedModes leave pull out.
  const supportsPull = (offer: Challenge.Challenge) => {
    const modes = getRecord(offer.request.methodDetails).supportedModes;
    return !Array.isArray(modes) || modes.includes("pull");
  };
  const [first] = tried;
  const recipient = (challenge: Challenge.Challenge) =>
    stringValue(challenge.request.recipient).toLowerCase();
  const withinFirst = (offer: Challenge.Challenge) => {
    const offered = amount(offer);
    const firstAmount = first && amount(first);
    return (
      first !== undefined &&
      recipient(offer) === recipient(first) &&
      offered !== undefined &&
      firstAmount !== undefined &&
      offered <= firstAmount
    );
  };
  let offers: Challenge.Challenge[];
  try {
    offers = Challenge.deserializeList(header);
  } catch {
    return undefined;
  }
  for (const offer of offers) {
    if (
      offer.intent !== "charge" ||
      !supportsPull(offer) ||
      failedAtOrBelow(offer) ||
      !withinFirst(offer)
    )
      continue;
    const headers = new Headers(selectedResponse.headers);
    headers.set("www-authenticate", Challenge.serialize(offer));
    try {
      const { challenge, response } = preparePaymentChallenge(
        new Response(null, { status: selectedResponse.status, headers }),
        { ...options, paymentIntent: "charge" },
        requestUrl,
      );
      return { challenge, response: tempoPaymentChallengeResponse(response) };
    } catch {
      // An offer that fails validation is no alternative.
    }
  }
  return undefined;
}

/** Pays `selectedChallenge` with a one-time charge and retries the request with its credential. */
async function payCharge(
  selectedChallenge: Challenge.Challenge,
  challengeResponse: Response,
  request: FetchPlan,
  options: RequestOptions,
) {
  try {
    const identity = await resolvePaymentIdentity(options);
    const getClient = identity.getClient;
    const methodOptions = {
      ...identity.methodOptions,
      expectedChainId: requestNetwork(options).chainId,
      getClient,
      maxDeposit: spendCap(options),
    };
    const charge = chargeSettlement(
      selectedChallenge,
      options,
      identity,
      machService(options, request.url),
    );
    const payment = Mppx.create({
      methods: [
        tempo.charge({ ...methodOptions, ...charge.parameters }),
        ...(options.paymentIntent === "auto" ? [tempo.subscription({ getClient })] : []),
      ],
      polyfill: false,
    });

    // A charge is checked against the spending policy, and funded, before mppx signs it; a
    // subscription's renewals cannot be bounded per charge, so it keeps mppx's own path.
    const credential = await (
      selectedChallenge.intent === "charge"
        ? createChargeCredential(payment, challengeResponse, {
            challenge: selectedChallenge,
            payer: identity.address,
            request: options,
          })
        : payment.createCredential(challengeResponse)
    ).catch(async (error: unknown) => {
      throw (await charge.limitError(error)) ?? error;
    });
    const paidInit = payment.transport.setCredential(cloneRequestInit(request.init), credential);
    const response = await fetchPaidRequest(
      { init: paidInit, url: request.url },
      options,
      credential,
    );
    recordChargeReceipt(response, selectedChallenge, credential, identity.address, options);
    return response;
  } catch (error) {
    if (error instanceof Errors.IncurError) throw error;
    throw paymentError(sanitizeText(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * `tempo.charge` options for paying `challenge` as `identity`, and the E_LIMIT_EXCEEDED error for
 * a credential the access key's spending limit refuses. The SDK signs the calls it resolves an
 * account for last, the MACH route or the direct transfer, so their first call names the token
 * the charge debits.
 */
function chargeSettlement(
  challenge: Challenge.Challenge,
  options: RequestOptions,
  identity: PaymentIdentity,
  service: MachService,
) {
  const amount = challengeAmount(challenge);
  const key = "key" in identity ? identity.key : undefined;
  const recipient = stringValue(challenge.request.recipient);
  const mach = machChargeParameters(options, { amount, key, recipient, service });
  let debited = stringValue(challenge.request.currency).toLowerCase();
  const parameters: ChargeParameters = {
    ...mach,
    async resolveAccount(info) {
      const token = info.operation.kind === "executeCalls" ? info.operation.calls?.[0]?.to : null;
      if (token) debited = token.toLowerCase();
      return (await mach.resolveAccount?.(info)) ?? info.account;
    },
  };
  return {
    parameters,
    async limitError(error: unknown) {
      if (!key || challenge.intent !== "charge") return undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (!/SpendingLimitExceeded|spending limit exceeded/i.test(message)) return undefined;
      // The SDK picks the fee token itself and does not expose it, so a fee-token limit failure
      // has no exact fix to suggest.
      if (/fee[\s_-]*token/i.test(message)) return undefined;
      const network = requestNetwork(options);
      // `keys update` reads --limit in the token's decimals, so without them there is no exact
      // limit to suggest.
      const token = await tokenMetadata(debited as Address, network.chainId, (address) =>
        readTokenMetadata(address, network.chainId, dryRunRpc),
      ).catch(() => undefined);
      if (!token) return undefined;
      return accessKeyLimitError({
        key: key.address,
        token: token.address,
        label: tokenLabel(token),
        amount: formatUnits(amount, token.decimals),
        network,
      });
    },
  };
}

/**
 * Records the receipt of a paid charge, or of a subscription's recurring authorization (its
 * period and expiry come from the offer). A zero-amount charge is a signed proof of the payer, not
 * a payment, so it has none. A MACH settlement debits MACH from the wallet, whether `--mach`
 * required it or the SDK chose it for a machine-enabled offer. A pushed charge names the
 * transaction the wallet sent; only a pulled one, which the server broadcasts, takes the hash
 * from the server's receipt.
 */
function recordChargeReceipt(
  response: Response,
  challenge: Challenge.Challenge,
  credential: string,
  payer: string,
  options: RequestOptions,
) {
  const amount = challengeAmount(challenge);
  if (amount === 0n) return;
  const network = requestNetwork(options);
  const deployment =
    machineTokenDeployments[network.chainId as keyof typeof machineTokenDeployments];
  const payload = credentialPayload(credential);
  const mach =
    deployment && (isMachPaymentToken(options.paymentToken) || runsMachRoute(payload, deployment));
  const request = challenge.request as Record<string, unknown>;
  paymentReceipts.set(
    response,
    paymentReceipt({
      intent: challenge.intent,
      amount,
      token: mach ? deployment.token : stringValue(challenge.request.currency),
      network,
      payer,
      txHash: payload.type === "hash" ? transactionHash(payload.hash) : receiptTxHash(response),
      subscription:
        challenge.intent === "subscription"
          ? {
              // mppx accepts a count given as a JSON number or a decimal string.
              period: `${typeof request.periodCount === "number" ? request.periodCount : stringValue(request.periodCount)} ${stringValue(request.periodUnit)}`,
              expires: stringValue(request.subscriptionExpires),
            }
          : undefined,
    }),
  );
}

function credentialPayload(credential: string) {
  try {
    return getRecord(Credential.deserialize<Record<string, unknown>>(credential).payload);
  } catch {
    return {};
  }
}

/**
 * Whether a failed session payment under `--payment-intent auto` offers a one-time charge instead:
 * an untyped failure, or a payment or `E_RUNTIME` one, such as sqlite3 failing on the session lock
 * or store, which a charge does not use. A retryable failure is rethrown for the caller to retry
 * the session, which is refundable where a charge is not, and other typed errors keep their code.
 */
function fallsBackToCharge(error: unknown) {
  if (!(error instanceof Errors.IncurError)) return true;
  return !error.retryable && (error.code === "E_PAYMENT" || error.code === "E_RUNTIME");
}

export function chargeFallbackError(
  header: string | null,
  sessionChallenge: Challenge.Challenge,
  options: RequestOptions,
  reason: unknown,
) {
  const challenge = chargeChallengeFromHeader(header, sessionChallenge, options);
  if (!challenge) return undefined;
  const amount = challengeAmount(challenge);
  if (options.maxSpend && amount > parseUnits(options.maxSpend, 6)) return undefined;
  const message = sanitizeText(reason instanceof Error ? reason.message : String(reason));
  const formattedAmount = formatTokenAmount(amount);
  return paymentError(
    `Session payment failed: ${message}\nA one-time charge of ${formattedAmount} is available but was not submitted because charge capacity is non-refundable. Review the amount, then retry with --max-spend ${formattedAmount} --payment-intent charge.`,
  );
}

/** The cheapest matching one-time charge the server offered, when it fits the spending cap. */
function chargeWithinCap(
  header: string | null,
  sessionChallenge: Challenge.Challenge,
  options: RequestOptions,
) {
  const challenge = chargeChallengeFromHeader(header, sessionChallenge, options);
  try {
    const amount = challenge ? challengeAmount(challenge) : undefined;
    if (amount !== undefined && amount <= parseUnits(spendCap(options), 6))
      return formatTokenAmount(amount);
  } catch {
    // A malformed charge offer is no alternative.
  }
  return undefined;
}
