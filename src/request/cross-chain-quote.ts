import { Errors as MachineFetchErrors } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import { type Address, formatUnits } from "viem";

import { SourceBalanceError } from "../payment/upstream/funding-limit.js";
import { type Destination, stargateConfig } from "../shared/chains.js";
import { sanitizeText } from "../shared/utils.js";
import {
  bridgeableSources,
  fundingAccounts,
  fundingRoutes,
  maxFundingSpend,
  relayUrl,
  sourceBalances,
} from "./cross-chain.js";
import type { RequestDryRunOutput } from "./dry-run.js";
import { crossChainDeadlineSeconds } from "./evm-charge.js";
import { parseMaxSlippageBps } from "./funding-mode.js";
import { requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";

export type CrossChainFundingQuote = NonNullable<
  Extract<RequestDryRunOutput, { payment_required: true }>["funding"]
>;

/** What a bridge's quote costs, in atomic units of the source token. */
export type QuoteCost = {
  /** The quoted source debit, the bridge's fee included. */
  amountIn: bigint;
  /** The bridge's fee: the debit beyond the delivered output, plus fees charged on top. */
  fee: bigint;
  /** Most the source-side transaction's gas may cost. */
  gas: bigint;
  /** Most the funding may debit, fees and gas included: what `--max-funding-spend` bounds. */
  total: bigint;
};

/** One route's answer: its quote's cost and whether the funding cap allows it, or why it declined. */
export type RouteAnswer =
  | { route: string; cost: QuoteCost; withinLimit: boolean }
  | { route: string; reason: string };

/** How long one route may take to quote, as machine-fetch allows. */
const quoteTimeoutMs = 10_000;

/**
 * The cost of `quote` for `request`, counted as machine-fetch's guarantees check counts it: the
 * most it may debit is its maximum input plus every fee not already included in it.
 */
export function quoteCost(quote: CrossChain.Quote, request: { amountOut: bigint }): QuoteCost {
  const fees = "fees" in quote ? quote.fees : [];
  const extra = (kind: "provider" | "gas") =>
    fees
      .filter((fee) => fee.kind === kind && !fee.includedInAmountIn)
      .reduce((sum, fee) => sum + fee.amount, 0n);
  const maxAmountIn = "maxAmountIn" in quote ? quote.maxAmountIn : quote.amountIn;
  const gas = fees.filter((fee) => fee.kind === "gas").reduce((sum, fee) => sum + fee.amount, 0n);
  return {
    amountIn: quote.amountIn,
    fee: quote.amountIn - request.amountOut + extra("provider"),
    gas,
    total: maxAmountIn + extra("provider") + extra("gas"),
  };
}

/** Why a route declined to quote, sanitized and bounded since it may quote a provider's response. */
function declineReason(error: unknown, symbol: string) {
  if (error instanceof SourceBalanceError)
    return `needs ${formatUnits(error.required, 6)} ${symbol}, the bridge's fee included, and the wallet holds ${formatUnits(error.held, 6)}`;
  const message =
    error instanceof MachineFetchErrors.BaseError
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : String(error);
  return sanitizeText(message).slice(0, 160);
}

/**
 * Quotes every route for `request` and picks the one funding would run: machine-fetch executes
 * the cheapest quote within the funding cap, the first configured winning a tie. When none is
 * within it, the cheapest quote is reported instead, so the cap it would need is visible. Nothing
 * is claimed, signed, or sent.
 */
export async function quoteRoutes(
  routes: readonly CrossChain.Route[],
  request: Omit<CrossChain.Request, "signal">,
  limit: bigint,
  symbol: string,
) {
  const answers: RouteAnswer[] = await Promise.all(
    routes.map(async (route) => {
      try {
        const quote = await route.quote({
          ...request,
          signal: AbortSignal.timeout(quoteTimeoutMs),
        });
        const cost = quoteCost(quote, request);
        return { route: route.name, cost, withinLimit: cost.total <= limit };
      } catch (error) {
        return { route: route.name, reason: declineReason(error, symbol) };
      }
    }),
  );
  const quoted = answers.filter((answer) => "cost" in answer);
  const cheapest = (candidates: typeof quoted) =>
    candidates.reduce<(typeof quoted)[number] | undefined>(
      (best, candidate) =>
        !best || candidate.cost.amountIn < best.cost.amountIn ? candidate : best,
      undefined,
    );
  const chosen = cheapest(quoted.filter((answer) => answer.withinLimit)) ?? cheapest(quoted);
  return { answers, chosen };
}

const amount = (value: bigint) => formatUnits(value, 6);

/**
 * The `--dry-run` preview of funding `shortfall` USDC on `destination` across chains, as a payment
 * with `--funding auto` would: from the first Tempo source token holding enough, through every
 * route it would quote, choosing as it would choose. It reads balances and quotes, and never
 * claims an attempt, saves an operation, or signs. A wallet whose remote payer does not exist yet
 * passes its Tempo address as `payer`: a quote never creates the payer, and the bridge's fees do
 * not depend on the recipient.
 */
export async function crossChainFundingQuote(options: {
  destination: Destination;
  source: Address;
  payer: Address;
  shortfall: bigint;
  request: RequestOptions;
}): Promise<CrossChainFundingQuote> {
  const { destination, source, payer, shortfall } = options;
  const network = requestNetwork(options.request);
  const limit = maxFundingSpend(options.request);
  const preview: CrossChainFundingQuote = {
    route: null,
    inputs: [],
    shortfall: amount(shortfall),
    raw_shortfall: shortfall.toString(),
    source_token: null,
    source_symbol: null,
    amount_in: null,
    raw_amount_in: null,
    fee: null,
    gas: null,
    total: null,
    max_funding_spend: amount(limit),
    within_funding_budget: null,
    quotes: [],
  };
  if (!relayUrl(network) && !stargateConfig(network.chainId))
    return {
      ...preview,
      reason: `Cross-chain funding is unavailable on ${network.name}: no bridge routes from it`,
    };
  const balances = await sourceBalances(network, source);
  const [usable] = bridgeableSources(balances, shortfall);
  if (!usable) {
    const held = balances.map((entry) => `${amount(entry.balance)} ${entry.symbol}`).join(", ");
    return {
      ...preview,
      reason: `Bridging ${amount(shortfall)} USDC to ${destination.name} needs more than the wallet holds (${held || "no bridgeable tokens"})`,
    };
  }
  const { asset, symbol } = usable;
  const { from, to } = fundingAccounts(network.chainId, source, asset, destination, payer);
  const routes = fundingRoutes({ network, asset, destination, payer, symbol });
  const { answers, chosen } = await quoteRoutes(
    routes,
    {
      amountOut: shortfall,
      deadline: Math.floor(Date.now() / 1000) + crossChainDeadlineSeconds,
      from,
      to,
      maxSlippageBps: parseMaxSlippageBps(options.request.maxSlippageBps),
      operationId: "dry-run",
    },
    limit,
    symbol,
  );
  const quotes = answers.map((answer) =>
    "cost" in answer
      ? {
          route: answer.route,
          amount_in: amount(answer.cost.amountIn),
          fee: amount(answer.cost.fee),
          gas: amount(answer.cost.gas),
          total: amount(answer.cost.total),
          within_funding_budget: answer.withinLimit,
          reason: null,
        }
      : {
          route: answer.route,
          amount_in: null,
          fee: null,
          gas: null,
          total: null,
          within_funding_budget: null,
          reason: answer.reason,
        },
  );
  const sourceFields = {
    inputs: [asset.toLowerCase()],
    source_token: asset.toLowerCase(),
    source_symbol: symbol,
    quotes,
  };
  if (!chosen)
    return {
      ...preview,
      ...sourceFields,
      reason: "No trusted cross-chain route can fund the payment",
    };
  return {
    ...preview,
    ...sourceFields,
    route: chosen.route,
    amount_in: amount(chosen.cost.amountIn),
    raw_amount_in: chosen.cost.amountIn.toString(),
    fee: amount(chosen.cost.fee),
    gas: amount(chosen.cost.gas),
    total: amount(chosen.cost.total),
    within_funding_budget: chosen.withinLimit,
  };
}
