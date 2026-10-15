import { Errors, type z } from "incur";
import type { Challenge } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";

import type { requestDryRunOutput } from "../schemas/request.js";
import { createTempoPublicClient } from "../shared/network.js";
import { nextStep } from "../shared/next.js";
import { walletFix } from "../shared/require-wallet.js";
import { knownToken, readTokenMetadata, tokenMetadata } from "../shared/tokens.js";
import { getRecord, stringValue } from "../shared/utils.js";
import { challengeAmount, normalizedChallengeChainId, sessionDetails } from "./challenge.js";
import {
  privateKeyIdentity,
  privateKeySigner,
  requestNetwork,
  storedAccessKeyLimit,
  walletIdentity,
} from "./identity.js";
import { isMachPaymentToken } from "./mach.js";
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
