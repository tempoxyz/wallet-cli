import { Errors, type z } from "incur";
import type { Challenge } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { formatUnits, parseUnits, type Address } from "viem";

import type { requestDryRunOutput } from "../schemas/request.js";
import { networkFields } from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { walletFix } from "../shared/require-wallet.js";
import { knownToken, readTokenMetadata, tokenMetadata } from "../shared/tokens.js";
import { getRecord, stringValue } from "../shared/utils.js";
import { destinationBalance, tempoFundingInputs } from "../shared/chains.js";
import { rpcChainCheck, tokenBalance } from "../wallet/key-output.js";
import { loadRemotePayer } from "../wallet/remote-payer.js";
import { challengeAmount, normalizedChallengeChainId, sessionDetails } from "./challenge.js";
import { chargeFunder } from "./funding.js";
import type { EvmOffer } from "./offers.js";
import {
  privateKeyIdentity,
  privateKeySigner,
  requestNetwork,
  storedAccessKeyLimit,
  walletIdentity,
} from "./identity.js";
import type { RequestOptions } from "./options.js";
import { dryRunRpc, planSessionPayment } from "./session.js";
import { formatTokenAmount, spendCap } from "./spend.js";

export type RequestDryRunOutput = z.infer<typeof requestDryRunOutput>;

/**
 * The 402 `--dry-run` quote. Session reuse and the deposit come from `planSessionPayment`, as for
 * a payment; nothing is signed, opened, or written. A payer, balance, token metadata, or session
 * read that fails is reported as `null`. A wallet that cannot pay has `null` payer fields, and
 * `instruction` and `_next` name the login or refresh command that fixes it.
 */
export async function paymentQuote(
  challenge: Challenge.Challenge,
  options: RequestOptions,
  requestUrl: string,
): Promise<RequestDryRunOutput> {
  const signer = privateKeySigner(options);
  const chainId = normalizedChallengeChainId(getRecord(challenge.request.methodDetails), options);
  const amount = challengeAmount(challenge);
  const token = stringValue(challenge.request.currency);
  const details = getRecord(challenge.request.methodDetails);
  // The SDK attempts MACH before the advertised token for eligible charges. A quote shows both
  // balances; balance alone cannot prove the route's liquidity, permissions, or simulation.
  const mach =
    challenge.intent === "charge" &&
    amount > 0n &&
    details.machineTokenEnabled === true &&
    !(Array.isArray(details.splits) && details.splits.length > 0)
      ? machineTokenDeployments[chainId as keyof typeof machineTokenDeployments]?.token
      : undefined;
  const wallet = signer ? undefined : await walletIdentity(options).catch(() => undefined);
  const fix =
    wallet && "code" in wallet ? walletFix(wallet.code, requestNetwork(options)) : undefined;
  const payer = privateKeyIdentity(options) ?? (wallet && !("code" in wallet) ? wallet : undefined);
  const servesChain = rpcChainCheck();
  const balanceOf = async (token: string) =>
    (
      await tokenBalance({
        chain: chainId,
        token,
        walletAddress: payer?.address ?? null,
        servesChain,
      })
    )?.raw ?? null;
  const [metadata, balance, machBalance, plan, funder] = await Promise.all([
    tokenMetadata(token.toLowerCase() as Address, chainId, (address) =>
      readTokenMetadata(address, chainId, dryRunRpc),
    ).catch(() => undefined),
    balanceOf(token),
    mach ? balanceOf(mach) : null,
    challenge.intent === "session" && payer
      ? planSessionPayment(sessionDetails(challenge, requestUrl, options), payer, options, {
          dryRun: true,
        }).catch((error: unknown) => {
          // An offer the payment would refuse still fails; a failed read, including an `E_RUNTIME`
          // session store sqlite3 cannot read, is unknown.
          if (error instanceof Errors.IncurError && error.code !== "E_RUNTIME") throw error;
          return undefined;
        })
      : undefined,
    challenge.intent === "charge" ? chargeFunder(challenge, options) : undefined,
  ]);
  const decimals = metadata?.decimals;
  const key = payer && "key" in payer ? payer.key : undefined;
  const limit = storedAccessKeyLimit(key, token);
  const machLimit = storedAccessKeyLimit(key, mach);
  // No cap bounds a subscription: an explicit one refuses it before this, and the default skips it.
  const cap = challenge.intent === "subscription" ? undefined : spendCap(options);
  const spend = challenge.intent === "session" ? plan?.signedCumulative : amount;
  return {
    payment_required: true,
    method: challenge.method,
    intent: challenge.intent,
    recurring: challenge.intent === "subscription",
    amount: formatTokenAmount(amount),
    raw_amount: amount.toString(),
    session: plan ? (plan.reusable ? "reuse" : "open") : null,
    deposit: plan ? formatTokenAmount(plan.depositRaw) : null,
    raw_deposit: plan ? plan.depositRaw.toString() : null,
    token: token.toLowerCase(),
    // The server picks the currency, so an unlisted token's self-declared ticker is not shown.
    symbol: knownToken(token, chainId)?.symbol ?? null,
    decimals: metadata?.decimals ?? null,
    balance: balance === null || decimals === undefined ? null : formatUnits(balance, decimals),
    access_key_limit:
      limit === null || decimals === undefined ? null : formatUnits(limit, decimals),
    mach: mach
      ? {
          token: mach.toLowerCase(),
          symbol: "MACH",
          balance: machBalance === null ? null : formatUnits(machBalance, 6),
          access_key_limit: machLimit === null ? null : formatUnits(machLimit, 6),
        }
      : null,
    machine_token_enabled: getRecord(challenge.request.methodDetails).machineTokenEnabled === true,
    payment_token: options.paymentToken ?? null,
    ...networkFields(chainId),
    max_spend: cap ?? null,
    within_budget: cap === undefined || spend === undefined ? null : spend <= parseUnits(cap, 6),
    signer: signer
      ? { address: signer.account.address.toLowerCase(), source: signer.source }
      : { address: null, source: "wallet" },
    ...(funder &&
    balance !== null &&
    balance < amount &&
    !(mach && machBalance !== null && machBalance >= amount)
      ? {
          funding: {
            route: funder,
            inputs: tempoFundingInputs(chainId).map((input) => input.toLowerCase()),
          },
        }
      : {}),
    ...(fix
      ? nextStep(
          `${fix.reason} Run the next command, then rerun this request without --dry-run to pay.`,
          fix.argv,
          { network: requestNetwork(options) },
        )
      : {}),
  };
}

/**
 * The `--dry-run` quote for an EVM offer, in the shape of a Tempo charge's. The payer is the
 * private-key signer or the wallet's remote payer, which a quote never creates; `balance` is its
 * USDC on the offer's chain, `null` when unknown.
 */
export async function evmPaymentQuote(
  offer: EvmOffer,
  options: RequestOptions,
): Promise<RequestDryRunOutput> {
  const { destination, requirement } = offer;
  const signer = privateKeySigner(options);
  const wallet = signer ? undefined : await walletIdentity(options).catch(() => undefined);
  const remote =
    wallet && !("code" in wallet)
      ? await loadRemotePayer(wallet.address).catch(() => undefined)
      : undefined;
  const payer = signer?.account.address ?? remote?.address;
  const balance = payer
    ? await destinationBalance(destination, payer).catch(() => null)
    : remote === undefined && wallet && !("code" in wallet)
      ? 0n
      : null;
  const cap = spendCap(options);
  return {
    payment_required: true,
    method: offer.kind === "x402" ? "x402" : offer.challenge.method,
    intent: "charge",
    recurring: false,
    amount: formatTokenAmount(requirement.amount),
    raw_amount: requirement.amount.toString(),
    session: null,
    deposit: null,
    raw_deposit: null,
    token: destination.usdc.address.toLowerCase(),
    symbol: "USDC",
    decimals: destination.usdc.decimals,
    balance: balance === null ? null : formatUnits(balance, destination.usdc.decimals),
    access_key_limit: null,
    mach: null,
    machine_token_enabled: false,
    payment_token: options.paymentToken ?? null,
    chain_id: destination.chainId,
    network: destination.name,
    max_spend: cap,
    within_budget: requirement.amount <= parseUnits(cap, 6),
    signer: { address: payer?.toLowerCase() ?? null, source: signer ? signer.source : "wallet" },
  };
}
