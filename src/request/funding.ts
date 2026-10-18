import type { PaymentRequirement } from "machine-fetch/interfaces";
import { mppxRequirement } from "machine-fetch/adapters/mppx";
import type { Challenge } from "mppx";

import {
  chargePolicy,
  type FundingOptions,
  fundingError,
  planAndFund,
  planCharge,
} from "../payment/funding.js";
import { getRecord } from "../shared/utils.js";
import { requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";
import { MaxSpendExceededError, spendCap } from "./spend.js";

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
  const policy = chargePolicy(challenge, { network, maxSpend: spendCap(options) });
  let requirement: PaymentRequirement | undefined;
  try {
    requirement = mppxRequirement(challenge);
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
  funding: Omit<FundingOptions, "policy">,
) {
  const challenge = planned(offer, options);
  const { policy, report } = chargeFunding(challenge, options);
  try {
    return await planAndFund(challenge, { ...funding, policy });
  } catch (error) {
    throw report(error);
  }
}
