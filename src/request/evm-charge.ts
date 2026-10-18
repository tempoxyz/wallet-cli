import { Errors } from "incur";
import type { PaymentPolicy } from "machine-fetch/interfaces";
import { evm, Mppx } from "mppx/client";
import { Assets } from "mppx/evm";
import { formatUnits, parseUnits } from "viem";

import { fundingError, planAndFund } from "../payment/funding.js";
import { paymentReceipt } from "../payment/receipt.js";
import { WalletRequiredError } from "../shared/require-wallet.js";
import { destinationBalance } from "../shared/chains.js";
import { paymentError, walletError } from "../shared/errors.js";
import { sanitizeText } from "../shared/utils.js";
import { ensureRemotePayer } from "../wallet/remote-payer.js";
import { crossChainFunding, relayUrl } from "./cross-chain.js";
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
  let policy: PaymentPolicy = {
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
  const funding = await crossChainFunding(offer, payer.address, request, options, stderr);
  const funders = funding?.funders ?? [];
  if (funding) policy = { ...policy, maxFundingSpend: funding.maxFundingSpend };
  let prepared;
  try {
    // The attempt ID was saved before this; the payer travels with it, so funding refuses to
    // deliver to any other account (MF-17, MF-18).
    prepared = await planAndFund(offer.challenge, {
      policy,
      funders,
      payer: payer.address,
      attemptId: funding?.attemptId,
    });
  } catch (error) {
    throw report(error);
  }
  if (!funding) await assertFunded(offer, payer, options);
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
        txHash: null,
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
    message: `The ${payer.wallet ? "remote payer" : "payer"} ${payer.address} holds ${held} USDC on ${destination.name}, below the ${needed} USDC this payment needs. Send USDC on ${destination.name} to ${payer.address}, then retry${relayUrl(requestNetwork(options)) ? ", or rerun with --funding auto to bridge it from OUSD" : ""}.`,
  });
}
