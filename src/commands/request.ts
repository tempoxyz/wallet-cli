import { Errors, type z } from "incur";
import { Challenge, Constants, Credential, PaymentRequest } from "mppx";
import { Mppx, session as tempoSession, tempo } from "mppx/client";
import { machineTokenDeployments, Session as TempoSession } from "mppx/tempo";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import { prepareTransactionRequest, signTransaction } from "viem/actions";
import { Abis as TempoAbis, Actions, Channel as TempoChannel } from "viem/tempo";

import {
  paymentReceipt,
  receiptSummary,
  receiptTxHash,
  transactionHash,
} from "../payment/receipt.js";
import { withSessionLock } from "../payment/session-lock.js";
import { requireSessionDescriptor } from "../payment/session-descriptor.js";
import {
  deleteSessionRecord,
  findReusableSessions,
  originFromUrl,
  type PersistedSessionRecord,
  preserveSessionCumulative,
  updateSessionReceipt,
  upsertSessionRecord,
} from "../payment/session-store.js";
import type { requestDryRunOutput } from "../schemas/request.js";
import { escrowAbi } from "../shared/constants.js";
import {
  accessKeyLimitError,
  httpError,
  paymentOutcomeUnknownError,
  paymentError,
  usageError,
  walletError,
} from "../shared/errors.js";
import { createTempoPublicClient, escrowContract, networkName } from "../shared/network.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import { walletFix } from "../shared/require-wallet.js";
import { knownToken, readTokenMetadata, tokenLabel, tokenMetadata } from "../shared/tokens.js";
import {
  escapeInvisible,
  getRecord,
  nowSeconds,
  parseOnChainBigInt,
  sanitizeText,
  stringValue,
} from "../shared/utils.js";
import { parseRequestArgs, paymentTokenValue, validateRequestOptions } from "../request/args.js";
import {
  buildFetchRequest,
  cloneRequestInit,
  type FetchPlan,
  fetchWithRetries,
  replaySafeMethods,
  type RequestInitWithDispatcher,
  responseBodyNetworkError,
} from "../request/fetch.js";
import {
  type PaymentIdentity,
  privateKeyIdentity,
  privateKeySigner,
  requestNetwork,
  resolvePaymentIdentity,
  resolvePaymentNetwork,
  storedAccessKeyLimit,
  walletIdentity,
  writePrivateKeyNotice,
} from "../request/identity.js";
import {
  type ChargeParameters,
  isMachPaymentToken,
  machChargeParameters,
  runsMachRoute,
} from "../request/mach.js";
import type { RequestOptions, RequestRunOptions } from "../request/options.js";
import {
  remoteNamePath,
  write,
  writeHeadersFile,
  writeMetaFile,
  writeOutput,
  writeResponseBody,
} from "../request/output.js";
import {
  fetchPaidRequest,
  paidResponseFailures,
  paymentReceipts,
  paymentReferences,
} from "../request/paid.js";
import {
  assertWithinMaxSpend,
  enforceMaxSpend,
  formatTokenAmount,
  MaxSpendExceededError,
  spendCap,
  spendCapLabel,
} from "../request/spend.js";

// `tempo wallet transfer` imports these from this path.
export { parseRequestArgs } from "../request/args.js";
export { resolvePaymentIdentity, resolvePaymentNetwork } from "../request/identity.js";
export { machChargeParameters } from "../request/mach.js";
export { resolveMaxSpend } from "../request/spend.js";

export async function runRequest(argv: readonly string[], io: RequestRunOptions = {}) {
  const options = parseRequestArgs(argv);
  await executeRequest(options, io);
}

// Pass exactly the validated offer to mppx. Observation hooks cannot reject payment.
export function preparePaymentChallenge(
  response: Response,
  options: RequestOptions,
  requestUrl: string,
) {
  const selected = selectPaymentTokenResponse(response, options.paymentToken);
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
      throw paymentError("Server did not offer a machine-enabled MACH charge");
    if (Array.isArray(details.splits) && details.splits.length > 0)
      throw paymentError("MACH settlement does not support split charge offers");
  }
  if (challenge.intent === "session") sessionDetails(challenge, requestUrl, options);
  const headers = new Headers(selected.headers);
  headers.set("www-authenticate", Challenge.serialize(challenge));
  return { challenge, response: new Response(null, { status: selected.status, headers }) };
}

export async function executeRequest(options: RequestOptions, io: RequestRunOptions = {}) {
  validateRequestOptions(options);
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const started = Date.now();
  const plan = await buildFetchRequest(options);
  const method = plan.init.method ?? "GET";
  let { request, response } = await fetchWithRetries(plan, options);

  let paid = false;

  if (options.dryRun && response.status !== 402) {
    await response.body?.cancel().catch(() => undefined);
    const probeMethod = method.toUpperCase();
    if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
    if (options.writeMeta) await writeMetaFile(options.writeMeta, response, started);
    const probe: RequestDryRunOutput = {
      payment_required: false,
      status: response.status,
      probe_sent: true,
      ...(replaySafeMethods.has(probeMethod)
        ? {}
        : {
            warning: `The ${probeMethod} request was sent to the server and may have had side effects`,
          }),
    };
    await writeOutput(options.output, `${JSON.stringify(probe, null, 2)}\n`, stdout);
    return;
  }

  if (response.status === 402) {
    // Only payment depends on the network, so free requests never read the wallet store.
    options.network = (await resolvePaymentNetwork(options)).name;
    options.paymentToken = paymentTokenValue(options);
    if (options.dryRun) {
      const { challenge } = preparePaymentChallenge(response, options, request.url);
      const quote = await paymentQuote(challenge, options, request.url);
      if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
      if (options.writeMeta) await writeMetaFile(options.writeMeta, response, started);
      await writeOutput(options.output, `${JSON.stringify(quote, null, 2)}\n`, stdout);
      return;
    }

    if (options.insecure && !options.allowInsecurePayment)
      throw paymentError(
        "Refusing to pay over a connection with TLS certificate verification disabled (--insecure); pass --allow-insecure-payment to override",
      );
    response = await payAndRetryRequest(response, request, options, stderr);
    paid = true;
  }

  // Only a 2xx response confirms the paid request: an HTTP error, an unfollowed redirect, or a
  // failed receipt update leaves the payment's outcome unknown, so it reports no receipt.
  const receipt =
    response.ok && !paidResponseFailures.has(response) ? paymentReceipts.get(response) : undefined;
  try {
    if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
    if (options.writeMeta)
      await writeMetaFile(
        options.writeMeta,
        response,
        started,
        paid ? privateKeySigner(options) : undefined,
        receipt,
      );
    if (response.status >= 400 && options.sseJson) {
      const body = await response.text().catch(responseBodyNetworkError(method));
      await writeOutput(
        options.output ?? (options.remoteName ? remoteNamePath(options.url) : undefined),
        `${JSON.stringify({ event: "error", status: response.status, message: `HTTP ${response.status}${body ? `: ${body}` : ""}`, ts: new Date().toISOString() })}\n`,
        stdout,
      );
    } else {
      await writeResponseBody(response, options, stdout, method);
    }
    if (paidResponseFailures.has(response))
      throw paymentOutcomeUnknownError(
        `Paid response processing failed; payment may have completed.${paymentReferences.get(response) ?? ""} Check any saved response metadata and contact the provider before retrying.`,
      );
    if (response.status >= 400) throw httpError(response.status);
  } catch (error) {
    // The body never fully arrived, so the receipt stays for recovery but is marked unconfirmed.
    if (receipt && options.writeMeta)
      await writeMetaFile(options.writeMeta, response, started, privateKeySigner(options), {
        ...receipt,
        outcome: "unknown",
      }).catch(() => undefined);
    if (
      paid &&
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "E_HTTP" || error.code === "E_PAYMENT_OUTCOME_UNKNOWN")
      )
    )
      throw paymentOutcomeUnknownError(
        `Paid response delivery failed; payment may have completed.${paymentReferences.get(response) ?? ""} Check any saved response metadata and contact the provider before retrying.`,
      );
    throw error;
  }
  if (receipt) {
    try {
      await write(stderr, receiptSummary(receipt));
    } catch {
      // The payment and its response already succeeded; the summary is best-effort.
    }
  }
}

type RequestDryRunOutput = z.infer<typeof requestDryRunOutput>;

type RpcOptions = Parameters<typeof createTempoPublicClient>[1];

// Dry-run reads only inform the quote, so a stalled RPC must not hold it up.
const dryRunRpc = { timeout: 3_000, retryCount: 0 };

/**
 * The 402 `--dry-run` quote. Session reuse and the deposit come from `planSessionPayment`, as for
 * a payment; nothing is signed, opened, or written. A payer, balance, token metadata, or session
 * read that fails is reported as `null`. A wallet that cannot pay has `null` payer fields, and
 * `instruction` and `_next` name the login or refresh command that fixes it.
 */
async function paymentQuote(
  challenge: Challenge.Challenge,
  options: RequestOptions,
  requestUrl: string,
): Promise<RequestDryRunOutput> {
  const signer = privateKeySigner(options);
  const chainId = normalizedChallengeChainId(getRecord(challenge.request.methodDetails), options);
  const amount = challengeAmount(challenge);
  const token = stringValue(challenge.request.currency);
  // MACH settles in the offered currency but debits MACH from the wallet.
  const debited = isMachPaymentToken(options.paymentToken)
    ? machineTokenDeployments[chainId as keyof typeof machineTokenDeployments]?.token
    : token;
  const wallet = signer ? undefined : await walletIdentity(options).catch(() => undefined);
  const fix =
    wallet && "code" in wallet ? walletFix(wallet.code, requestNetwork(options)) : undefined;
  const payer = privateKeyIdentity(options) ?? (wallet && !("code" in wallet) ? wallet : undefined);
  const [metadata, balance, plan] = await Promise.all([
    tokenMetadata(token.toLowerCase() as Address, chainId, (address) =>
      readTokenMetadata(address, chainId, dryRunRpc),
    ).catch(() => undefined),
    payer && debited ? dryRunBalance(payer.address, debited, chainId) : null,
    challenge.intent === "session" && payer
      ? planSessionPayment(sessionDetails(challenge, requestUrl, options), payer, options, {
          dryRun: true,
        }).catch((error: unknown) => {
          // An offer the payment would refuse still fails; a failed read is unknown.
          if (error instanceof Errors.IncurError) throw error;
          return undefined;
        })
      : undefined,
  ]);
  // MACH is listed, so its decimals need no read.
  const debitedToken =
    debited === token ? metadata : debited === undefined ? undefined : knownToken(debited, chainId);
  const decimals = debitedToken?.decimals;
  const limit = storedAccessKeyLimit(payer && "key" in payer ? payer.key : undefined, debited);
  // No cap bounds a subscription: an explicit one refuses it before this, and the default skips it.
  const cap = challenge.intent === "subscription" ? undefined : spendCap(options);
  const spend = challenge.intent === "session" ? plan?.signedCumulative : amount;
  return {
    payment_required: true,
    method: challenge.method,
    intent: challenge.intent,
    recurring: challenge.intent === "subscription",
    amount: formatTokenAmount(amount),
    amount_raw: amount.toString(),
    session: plan ? (plan.reusable ? "reuse" : "open") : null,
    deposit: plan ? formatTokenAmount(plan.depositRaw) : null,
    deposit_raw: plan ? plan.depositRaw.toString() : null,
    token,
    // The server picks the currency, so an unlisted token's self-declared ticker is not shown.
    symbol: knownToken(token, chainId)?.symbol ?? null,
    decimals: metadata?.decimals ?? null,
    balance: balance === null || decimals === undefined ? null : formatUnits(balance, decimals),
    access_key_limit:
      limit === null || decimals === undefined ? null : formatUnits(limit, decimals),
    machine_token_enabled: getRecord(challenge.request.methodDetails).machineTokenEnabled === true,
    payment_token: options.paymentToken ?? null,
    chain_id: chainId,
    max_spend: cap ?? null,
    within_budget: cap === undefined || spend === undefined ? null : spend <= parseUnits(cap, 6),
    signer: signer
      ? { address: signer.account.address, source: signer.source }
      : { address: null, source: "wallet" },
    ...(fix
      ? nextStep(
          `${fix.reason} Run the next command, then rerun this request without --dry-run to pay.`,
          fix.argv,
          { network: requestNetwork(options) },
        )
      : {}),
  };
}

/** The payer's raw balance of `token`, or `null` when the read fails. */
function dryRunBalance(payer: string, token: string, chainId: number) {
  return createTempoPublicClient(chainId, dryRunRpc)
    .readContract({
      address: token as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [payer as Address],
    })
    .catch(() => null);
}

async function payAndRetryRequest(
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
      // Only payment failures fall back to a charge offer; other typed errors keep their code.
      if (
        options.paymentIntent === "auto" &&
        !(error instanceof Errors.IncurError && error.code !== "E_PAYMENT")
      )
        throw chargeFallbackError(header, sessionChallenge, options, error) ?? error;
      throw error;
    }
    return response;
  }

  if (options.paymentIntent === "session")
    throw paymentError("Server did not offer a compatible 'session' payment intent");

  try {
    const identity = await resolvePaymentIdentity(options);
    const getClient = identity.getClient;
    const methodOptions = {
      ...identity.methodOptions,
      expectedChainId: requestNetwork(options).chainId,
      getClient,
      maxDeposit: spendCap(options),
    };
    const charge = chargeSettlement(selectedChallenge, options, identity);
    const payment = Mppx.create({
      methods: [
        tempo.charge({ ...methodOptions, ...charge.parameters }),
        ...(options.paymentIntent === "auto" ? [tempo.subscription({ getClient })] : []),
      ],
      polyfill: false,
    });

    payment.onChallengeReceived(async ({ challenge, createCredential }) =>
      createCredential(paymentContext(challenge, options) as never),
    );

    const credential = await payment
      .createCredential(challengeResponse)
      .catch(async (error: unknown) => {
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
) {
  const amount = challengeAmount(challenge);
  const key = "key" in identity ? identity.key : undefined;
  const mach = machChargeParameters(options, { amount, key });
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

async function paySessionAndRetryRequest(
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

function sessionDetails(
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

type SessionDetails = ReturnType<typeof sessionDetails>;

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
async function planSessionPayment(
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

async function tryTopUpAndRetry(options: {
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
function sessionShortfall(
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

async function persistSessionReceipt(
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

function chargeChallengeFromHeader(
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

function normalizedChallengeChainId(
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

function challengeAmount(challenge: Challenge.Challenge) {
  const amount = (challenge.request as Record<string, unknown>).amount;
  if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  throw paymentError("Charge challenge is missing amount");
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

function bigintField(value: unknown, name: string) {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw paymentError(`Session challenge is missing ${name}`);
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
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

export function selectPaymentTokenResponse(response: Response, token: string | undefined) {
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

function paymentContext(challenge: { intent: string }, options: RequestOptions) {
  if (challenge.intent !== "session" || !options.maxSpend) return undefined;
  return { depositRaw: parseUnits(options.maxSpend, 6).toString() };
}

function validatePaymentAddresses(challenge: Challenge.Challenge) {
  const request = challenge.request as Record<string, unknown>;
  if (!isAddress(stringValue(request.currency)))
    throw paymentError("Payment challenge is missing a valid currency address");
  const isProof = challenge.intent === "charge" && BigInt(request.amount as string) === 0n;
  if (!isProof && !isAddress(stringValue(request.recipient)))
    throw paymentError("Payment challenge is missing a valid recipient address");
}
