import type { Funder, Payment } from "machine-fetch";
import { MppxFetch } from "machine-fetch/mppx";
import type { Challenge } from "mppx";

import { type Address, erc20Abi, formatUnits } from "viem";

import {
  chargePolicy,
  type FundingOptions,
  fundingError,
  planAndFund,
  planCharge,
} from "../payment/funding.js";
import { tempoFunding } from "../payment/tempo-funding.js";
import { createTempoPublicClient } from "../shared/network.js";
import { knownToken } from "../shared/tokens.js";
import { getRecord } from "../shared/utils.js";
import { accessKeyLimitError } from "../wallet/access-key.js";
import type { WalletState } from "../wallet/store.js";
import { fundingSetting, parseMaxSlippageBps } from "./funding-mode.js";
import { accessKeySpendLimit, requestNetwork } from "./identity.js";
import { isMachPaymentToken } from "./mach.js";
import type { RequestOptions } from "./options.js";
import { MaxSpendExceededError, spendCap } from "./spend.js";

/** Who pays a charge: the address that holds the tokens, and its access key, if one signs. */
export type ChargePayer = {
  address: string;
  key?: WalletState["accessKeys"][number] | undefined;
};

/**
 * The funders a charge may use, cheapest first (D4). `--funding off` and MACH settlement, which
 * must never spend stablecoins (see `machChargeParameters`), use none.
 */
export function chargeFunders(
  options: RequestOptions,
  payer: ChargePayer,
): Funder.Funder<unknown>[] {
  if (fundingSetting(options.funding).value === "off") return [];
  if (isMachPaymentToken(options.paymentToken)) return [];
  const network = requestNetwork(options);
  const { key } = payer;
  return [
    tempoFunding({
      chainId: network.chainId,
      balance: (token) => tokenBalance(network.chainId, token, payer.address as Address),
      // The access key's own limit refuses the swap's spend inside signing: skip inputs it may
      // not spend, and when none it may spend is held, name the fix before signing.
      canSpend: async ({ token, maxAmount }) => {
        if (!key) return true;
        const limit = await accessKeySpendLimit(key, token);
        return limit === null || limit >= maxAmount;
      },
      beforeSwap: async ({ token, maxAmount }) => {
        if (!key) return;
        const limit = await accessKeySpendLimit(key, token);
        if (limit === null || limit >= maxAmount) return;
        throw accessKeyLimitError({
          key: key.address,
          token: token.toLowerCase(),
          label: knownToken(token, network.chainId)?.symbol ?? token,
          amount: formatUnits(maxAmount, 6),
          network,
        });
      },
    }) as Funder.Funder<unknown>,
  ];
}

function tokenBalance(chainId: number, token: Address, owner: Address) {
  return createTempoPublicClient(chainId).readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * The challenge as policy and funders see it. The CLI pays an offer that names no chain on the
 * request network (see `preparePaymentChallenge`), so its requirement is on that network too.
 * Only planning uses it; the credential signs the offer as received.
 */
function planned(challenge: Challenge.Challenge, options: RequestOptions): Challenge.Challenge {
  const details = getRecord(challenge.request.methodDetails);
  if (challenge.method !== "tempo" || details.chainId !== undefined) return challenge;
  return {
    ...challenge,
    request: {
      ...challenge.request,
      methodDetails: { ...details, chainId: requestNetwork(options).chainId },
    },
  };
}

/** The charge's funding policy and the error context its failures are reported with. */
function chargeFunding(challenge: Challenge.Challenge, options: RequestOptions) {
  const network = requestNetwork(options);
  const policy = {
    ...chargePolicy(challenge, { network, maxSpend: spendCap(options) }),
    maxSlippageBps: parseMaxSlippageBps(options.maxSlippageBps),
  };
  let requirement: Payment.Requirement | undefined;
  try {
    requirement = MppxFetch.requirement(challenge);
  } catch {
    // planCharge reports the malformed challenge.
  }
  const report = (error: unknown) =>
    fundingError(error, {
      network,
      policy,
      requirement,
      maxSpendExceeded: (required) => new MaxSpendExceededError(required, options),
    });
  return { policy, report };
}

/**
 * The funder that would prepare a charge, planned without policy so a quote never refuses;
 * nothing is read or moved. `undefined` when the payment proceeds directly.
 */
export async function chargeFunder(offer: Challenge.Challenge, options: RequestOptions) {
  try {
    const plan = await planCharge(planned(offer, options), {
      policy: {},
      funders: chargeFunders(options, { address: "0x0000000000000000000000000000000000000000" }),
    });
    return plan.funder?.name;
  } catch {
    return undefined;
  }
}

/** Checks a charge against policy without preparing it, as `--dry-run` does. */
export async function checkCharge(offer: Challenge.Challenge, options: RequestOptions) {
  const challenge = planned(offer, options);
  const { policy, report } = chargeFunding(challenge, options);
  try {
    return await planCharge(challenge, { policy });
  } catch (error) {
    throw report(error);
  }
}

/** Plans and prepares a charge for `payer`; no credential is created without it. */
export async function prepareCharge(
  offer: Challenge.Challenge,
  options: RequestOptions,
  payer: ChargePayer,
  funding: Omit<FundingOptions, "policy" | "funders" | "payer"> = {},
) {
  const challenge = planned(offer, options);
  const { policy, report } = chargeFunding(challenge, options);
  try {
    return await planAndFund(challenge, {
      ...funding,
      policy,
      funders: chargeFunders(options, payer),
      payer: payer.address,
    });
  } catch (error) {
    throw report(error);
  }
}
