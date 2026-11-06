import { Errors } from "incur";
import { Funder, type Policy } from "machine-fetch";
import { evm, Mppx } from "mppx/client";
import { Assets } from "mppx/evm";
import { formatUnits, parseUnits } from "viem";

import { fundingError, type FundingOptions, planAndFund } from "../payment/funding.js";
import { evmReceiptTxHash, paymentReceipt } from "../payment/receipt.js";
import { WalletRequiredError } from "../shared/require-wallet.js";
import { destinationBalance } from "../shared/chains.js";
import { networkError, paymentError, walletError } from "../shared/errors.js";
import type { Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { sanitizeText } from "../shared/utils.js";
import { ensureRemotePayer } from "../wallet/remote-payer.js";
import { crossChainEnabled, crossChainFunding, relayUrl } from "./cross-chain.js";
import { cloneRequestInit, type FetchPlan } from "./fetch.js";
import { parseMaxSlippageBps } from "./funding-mode.js";
import {
  privateKeySigner,
  requestNetwork,
  walletIdentity,
  writePrivateKeyNotice,
} from "./identity.js";
import { credentialHeader, type EvmOffer } from "./offers.js";
import type { RequestOptions } from "./options.js";
import { fetchPaidRequest, paymentReceipts } from "./paid.js";
import { MaxSpendExceededError, spendCap } from "./spend.js";

/**
 * The account that pays EVM offers: a `--private-key` / `TEMPO_PRIVATE_KEY` signer, which is an
 * EOA on every chain, else the logged-in wallet's remote payer, created on first use.
 */
export async function evmPayer(options: RequestOptions) {
  const signer = privateKeySigner(options);
  if (signer)
    return { address: signer.account.address, account: signer.account, wallet: undefined };
  const identity = await walletIdentity(options);
  if ("code" in identity) throw new WalletRequiredError(identity);
  const payer = await ensureRemotePayer(identity.address);
  return { ...payer, wallet: identity };
}

export type EvmPayer = Awaited<ReturnType<typeof evmPayer>>;

/**
 * Pays an EVM offer from the remote payer (Phase 3): the charge is planned against policy, its
 * funders run, and only then does Mppx's `evm` method sign the EIP-3009 authorization, for exactly
 * this offer, on a chain and in a token from the destination table.
 */
export async function payEvmAndRetry(
  offer: EvmOffer,
  request: FetchPlan,
  options: RequestOptions,
  stderr: Pick<NodeJS.WriteStream, "write">,
) {
  const network = requestNetwork(options);
  const { destination, requirement } = offer;
  let policy: Policy.Policy = {
    maxPayment: [
      {
        network: destination.network,
        asset: destination.usdc.address,
        amount: parseUnits(spendCap(options), 6),
      },
    ],
    maxSlippageBps: parseMaxSlippageBps(options.maxSlippageBps),
  };
  const report = (error: unknown) =>
    fundingError(error, {
      network,
      policy,
      requirement,
      maxSpendExceeded: (required) => new MaxSpendExceededError(required, options),
    });
  writePrivateKeyNotice(stderr, options);
  const payer = await evmPayer(options);
  // A challenge expiring before any bridge could deliver is refused before an attempt is saved,
  // unless the payer already holds the USDC and nothing needs to move.
  const deadlineSeconds = fundingDeadlineSeconds(offer.challenge.expires);
  if (
    crossChainEnabled(options) &&
    deadlineSeconds !== undefined &&
    deadlineSeconds < 1 &&
    (await destinationBalance(destination, payer.address).catch(() => 0n)) < requirement.amount
  )
    throw expiresTooSoonError();
  const funding = await crossChainFunding(offer, payer.address, request, options, stderr);
  const funders = funding?.funders ?? [];
  // Without a challenge expiry the policy leaves `deadlineSeconds` unset, so each funder applies
  // its own default: 300 s for a bridge, which outlasts machine-fetch's 30 s payment default. With
  // one, the bridge must deliver before it, or the payer would hold USDC for a challenge Mppx then
  // refuses to sign.
  if (funding)
    policy = {
      ...policy,
      maxFundingSpend: funding.maxFundingSpend,
      ...(deadlineSeconds !== undefined && deadlineSeconds >= 1 ? { deadlineSeconds } : {}),
    };
  // `--timeout` bounds funding and signing as well as the request: past it, nothing is signed.
  const signal = request.init.signal ?? undefined;
  const timedOut = () => timeoutError(network, funding?.attemptId);
  let prepared;
  try {
    // The attempt ID was saved before this; the payer travels with it, so funding refuses to
    // deliver to any other account (MF-17, MF-18).
    prepared = await planAndFundFromEachSource(
      offer.challenge,
      { policy, funders, payer: payer.address, operationId: funding?.attemptId, signal },
      funding?.claimed ?? (async () => false),
      funding?.bridges ?? false,
    );
  } catch (error) {
    // Keeps an attempt whose operation was saved, so a bridge already sent stays recoverable.
    await funding?.abandon().catch(() => undefined);
    if (signal?.aborted) throw timedOut();
    throw report(error);
  }
  if (!funding) await assertFunded(offer, payer, options);
  // Funding may have delivered; its attempt stays, so a rerun reuses that delivery.
  if (signal?.aborted) throw timedOut();
  try {
    const payment = Mppx.create({
      methods: [
        evm.charge({
          account: payer.account,
          networks: [destination.chainId],
          currencies: [
            Assets.define({
              address: destination.usdc.address,
              decimals: destination.usdc.decimals,
              network: destination.network,
              transfer: {
                type: "eip3009",
                name: destination.usdc.name,
                version: destination.usdc.version,
              },
            }),
          ],
        }),
      ],
      polyfill: false,
    });
    const credential = await payment.createCredential(
      offer.response,
      prepared.credentialContext as never,
    );
    if (signal?.aborted) throw timedOut();
    const init = cloneRequestInit(request.init);
    const headers = new Headers(init.headers);
    headers.set(credentialHeader(offer), credential);
    init.headers = headers;
    const response = await fetchPaidRequest(
      { init, url: request.url },
      options,
      credential,
    ).finally(
      // The credential was sent, so the funding was used; a rerun funds anew.
      () => funding?.settled(),
    );
    paymentReceipts.set(
      response,
      paymentReceipt({
        intent: "charge",
        amount: requirement.amount,
        token: destination.usdc.address,
        network,
        payer: payer.address,
        txHash: evmReceiptTxHash(response, [
          destination.network.toLowerCase(),
          destination.name.toLowerCase(),
        ]),
        chain: { chainId: destination.chainId, name: destination.name },
        listed: { symbol: "USDC", decimals: destination.usdc.decimals },
      }),
    );
    return response;
  } catch (error) {
    if (error instanceof Errors.IncurError) throw error;
    throw paymentError(sanitizeText(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Plans and funds with each cross-chain funder in turn, one per Tempo source token in preference
 * order. machine-fetch funds with the first funder that matches, so a token that clears the
 * `bridgeableSources` floor but cannot cover any route's real quote would otherwise fail a payment
 * a later token could fund. Only that refusal moves on, and only while no operation was saved;
 * any other failure, or the last token's, is final.
 */
async function planAndFundFromEachSource(
  challenge: EvmOffer["challenge"],
  options: FundingOptions,
  claimed: () => Promise<boolean>,
  bridges: boolean,
) {
  const funders = options.funders ?? [];
  let refusal: unknown;
  for (const [index, funder] of funders.entries()) {
    let { policy } = options;
    // Reconciling earlier attempts and quoting earlier tokens take time: each bridge must still
    // land before the challenge expires, so its deadline is measured as it starts, and none starts
    // once too little is left.
    if (bridges && challenge.expires) {
      const deadlineSeconds = fundingDeadlineSeconds(challenge.expires)!;
      if (deadlineSeconds < 1) throw refusal ?? expiresTooSoonError();
      policy = { ...policy, deadlineSeconds };
    }
    try {
      return await planAndFund(challenge, { ...options, policy, funders: [funder] });
    } catch (error) {
      if (
        index === funders.length - 1 ||
        options.signal?.aborted ||
        !sourceShortfall(error) ||
        (await claimed())
      )
        throw error;
      refusal = error;
    }
  }
  return planAndFund(challenge, options);
}

/** E_PAYMENT for a challenge expiring before any bridge could deliver: nothing moved. */
function expiresTooSoonError() {
  return paymentError(
    "The payment challenge expires too soon to bridge funding before it; nothing was funded or paid. Retry the request for a fresh challenge.",
  );
}

/** Every route refused only because the source token could not cover its quote. */
function sourceShortfall(error: unknown) {
  return (
    Funder.cheapestRefusal(error, Funder.SourceBalanceError) !== undefined &&
    Funder.cheapestRefusal(error, Funder.FundingLimitError) === undefined
  );
}

/** Seconds left to sign and send the credential once funding delivered. */
const signingMarginSeconds = 15;
/** machine-fetch's cross-chain funders' own deadline, which an expiry only shortens. */
const bridgeDeadlineSeconds = 300;

/**
 * How long cross-chain funding may take so its delivery lands before the challenge expires, with
 * `signingMarginSeconds` left to sign and send: undefined without an expiry, and under 1 when the
 * challenge expires too soon to fund.
 */
export function fundingDeadlineSeconds(expires: string | undefined, now = Date.now()) {
  if (!expires) return undefined;
  const left = Math.floor((Date.parse(expires) - now) / 1000) - signingMarginSeconds;
  return Math.min(bridgeDeadlineSeconds, left);
}

/**
 * Retryable E_NETWORK for a `--timeout` that ran out before the credential was sent: nothing was
 * paid. With cross-chain funding, the attempt is kept: a rerun of the same request reuses what it
 * delivered, and `funding recover` reconciles a bridge still in flight.
 */
function timeoutError(network: Network, attemptId: string | undefined) {
  const recover =
    attemptId === undefined
      ? ""
      : ` Cross-chain funding may have started; rerun the same request to reuse it, or check it with '${continuationCommand(["wallet", "funding", "recover", attemptId], network)}'.`;
  return networkError(
    `The request timed out (--timeout) before the payment was sent; nothing was paid.${recover}`,
    { retryable: true },
  );
}

/**
 * Refuses, before signing, an offer the payer's USDC on its chain cannot cover when nothing funds
 * it. An unreadable balance is left to the server's settlement, which moves nothing it lacks.
 */
async function assertFunded(offer: EvmOffer, payer: EvmPayer, options: RequestOptions) {
  const { destination, requirement } = offer;
  const balance = await destinationBalance(destination, payer.address).catch(() => undefined);
  if (balance === undefined || balance >= requirement.amount) return;
  const held = formatUnits(balance, destination.usdc.decimals);
  const needed = formatUnits(requirement.amount, destination.usdc.decimals);
  throw walletError({
    code: "E_INSUFFICIENT_FUNDS",
    message: `The ${payer.wallet ? "remote payer" : "payer"} ${payer.address} holds ${held} USDC on ${destination.name}, below the ${needed} USDC this payment needs. Send USDC on ${destination.name} to ${payer.address}, then retry${relayUrl(requestNetwork(options)) ? ", or rerun with --funding auto to bridge it from the Tempo wallet" : ""}.`,
  });
}
