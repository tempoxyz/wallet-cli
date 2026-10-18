import { type Address, erc20Abi } from "viem";

import { destinationBalance, tempoFundingInputs } from "../shared/chains.js";
import { crossChainEnabled } from "./cross-chain.js";
import { paymentError } from "../shared/errors.js";
import { createTempoPublicClient } from "../shared/network.js";
import { escapeInvisible } from "../shared/utils.js";
import { loadRemotePayer } from "../wallet/remote-payer.js";
import { challengeAmount, preparePaymentChallenge } from "./challenge.js";
import { fundingSetting } from "./funding-mode.js";
import { privateKeySigner, requestNetwork, walletIdentity } from "./identity.js";
import { type EvmOffer, evmOffers, offersTempo } from "./offers.js";
import type { RequestOptions } from "./options.js";

/** Which offer of a 402 to pay: a Tempo offer, through the existing Tempo path, or an EVM offer. */
export type Selection = { kind: "tempo" } | { kind: "evm"; offer: EvmOffer };

/**
 * Chooses between a 402's Tempo and EVM offers, deterministically (Phase 3): (1) a Tempo offer in a
 * token the wallet holds; (2) a Tempo offer a Tempo DEX swap can fund; (3) an EVM offer the payer
 * already holds the USDC for; (4) an EVM offer funding must bridge to (with `--funding auto`).
 * Otherwise the Tempo offer, which reports why it cannot be paid. `--payment-network` overrides
 * the ranking. `--funding off` ignores EVM offers, as before funding existed. Ranking without
 * quotes is a heuristic ([MF-4]); balances are read only when both kinds are offered.
 */
export async function selectPayment(
  response: Response,
  options: RequestOptions,
  requestUrl: string,
): Promise<Selection> {
  const mode = fundingSetting(options.funding).value;
  const forced = options.paymentNetwork?.toLowerCase();
  if (mode === "off" || forced === "tempo") return { kind: "tempo" };
  const { offers, refused } = evmOffers(response, options);
  const tempo = offersTempo(response);
  const why = refused.length > 0 ? ` (${refused.map(escapeInvisible).join("; ")})` : "";
  if (forced) {
    const offer = offers.find((candidate) => candidate.destination.name === forced);
    if (!offer)
      throw paymentError(
        `Server did not offer a payable charge on ${escapeInvisible(forced)}${why}`,
      );
    return { kind: "evm", offer };
  }
  if (offers.length === 0) {
    if (!tempo && refused.length > 0)
      throw paymentError(`Server did not offer a payable payment${why}`);
    return { kind: "tempo" };
  }
  if (!tempo) return { kind: "evm", offer: (await fundedOffer(offers, options)) ?? offers[0]! };
  const rank = await tempoRank(response, options, requestUrl, mode);
  if (rank !== undefined) return { kind: "tempo" };
  const funded = await fundedOffer(offers, options);
  if (funded) return { kind: "evm", offer: funded };
  if (crossChainEnabled(options)) return { kind: "evm", offer: offers[0]! };
  return { kind: "tempo" };
}

/**
 * Whether the Tempo offer ranks first: 1 when the payer holds its token, 2 when a funding input
 * covers a swap for it, `undefined` when neither (or it is not payable at all). A session offer
 * keeps the Tempo path, which prefers sessions.
 */
async function tempoRank(
  response: Response,
  options: RequestOptions,
  requestUrl: string,
  mode: string,
): Promise<1 | 2 | undefined> {
  let challenge;
  try {
    ({ challenge } = preparePaymentChallenge(response, options, requestUrl));
  } catch {
    return undefined;
  }
  if (challenge.intent !== "charge") return 1;
  const payer = await tempoPayerAddress(options);
  if (!payer) return undefined;
  const chainId = requestNetwork(options).chainId;
  const amount = challengeAmount(challenge);
  const balance = (token: string) =>
    createTempoPublicClient(chainId)
      .readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [payer],
      })
      .catch(() => 0n);
  if ((await balance(String(challenge.request.currency))) >= amount) return 1;
  if (mode === "off") return undefined;
  for (const input of tempoFundingInputs(chainId)) if ((await balance(input)) >= amount) return 2;
  return undefined;
}

async function tempoPayerAddress(options: RequestOptions) {
  const signer = privateKeySigner(options);
  if (signer) return signer.account.address;
  const identity = await walletIdentity(options).catch(() => undefined);
  return identity && !("code" in identity) ? (identity.address as Address) : undefined;
}

/** The first offer whose USDC the payer already holds, without creating a remote payer. */
async function fundedOffer(offers: EvmOffer[], options: RequestOptions) {
  const payer = await evmPayerAddress(options);
  if (!payer) return undefined;
  for (const offer of offers) {
    const balance = await destinationBalance(offer.destination, payer).catch(() => 0n);
    if (balance >= offer.requirement.amount) return offer;
  }
  return undefined;
}

async function evmPayerAddress(options: RequestOptions) {
  const signer = privateKeySigner(options);
  if (signer) return signer.account.address;
  const identity = await walletIdentity(options).catch(() => undefined);
  if (!identity || "code" in identity) return undefined;
  return (await loadRemotePayer(identity.address))?.address;
}
