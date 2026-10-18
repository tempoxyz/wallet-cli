import { FundingError } from "machine-fetch";
import { crossChainFund } from "machine-fetch/funders/cross-chain";
import type {
  CrossChainFunder,
  CrossChainOperation,
  CrossChainRoute,
  EvmAccount,
} from "machine-fetch/interfaces/evm";
import { fileStore } from "machine-fetch/stores/file";
import { type Address, formatUnits, parseUnits } from "viem";
import { Actions } from "viem/tempo";

import { CtaError } from "../cli/incur-compat.js";
import {
  type AttemptRecord,
  claimAttempt,
  listAttempts,
  operationsDirectory,
  removeAttempt,
  requestFingerprint,
} from "../payment/attempts.js";
import { caip2 } from "../payment/funding.js";
import { requirementKey } from "../payment/upstream/requirement-key.js";
import { relayDepositRoute } from "../payment/upstream/relay-route.js";
import { type Destination, destinationBalance, tempoFundingInputs } from "../shared/chains.js";
import { commandError, paymentError } from "../shared/errors.js";
import type { Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import type { FetchPlan } from "./fetch.js";
import { fundingSetting } from "./funding-mode.js";
import { requestNetwork, resolvePaymentIdentity } from "./identity.js";
import type { EvmOffer } from "./offers.js";
import type { RequestOptions } from "./options.js";
import { spendCap } from "./spend.js";

/** Most the Tempo-side deposit transfer's fee may cost, in OUSD: 0.02. */
export const maxDepositGas = 20_000n;

/**
 * The cap on one cross-chain funding operation's OUSD spend, transfer and gas together:
 * `--max-funding-spend`, else `--max-spend` plus 5% and 0.10 for Relay's fee and gas.
 */
export function maxFundingSpend(options: RequestOptions) {
  if (options.maxFundingSpend !== undefined) return parseUnits(options.maxFundingSpend, 6);
  const cap = parseUnits(spendCap(options), 6);
  return cap + (cap * 5n) / 100n + 100_000n;
}

/** Whether cross-chain funding may run: `--funding auto` or `TEMPO_EXPERIMENTAL_CROSS_CHAIN=1`. */
export function crossChainEnabled(options: RequestOptions) {
  return (
    fundingSetting(options.funding).value === "auto" ||
    process.env.TEMPO_EXPERIMENTAL_CROSS_CHAIN === "1"
  );
}

/** Relay's API for `network`: `TEMPO_RELAY_URL`, else Relay itself on mainnet; none on testnet. */
export function relayUrl(network: Network) {
  if (process.env.TEMPO_RELAY_URL) return process.env.TEMPO_RELAY_URL;
  return network.name === "mainnet" ? "https://api.relay.link" : undefined;
}

/** The Tempo-side and destination-side accounts of funding from `source` to `payer`. */
function accounts(tempoChainId: number, source: Address, destination: Destination, payer: Address) {
  const ousd = tempoFundingInputs(tempoChainId)[0];
  if (!ousd) throw paymentError(`Cross-chain funding has no source token on chain ${tempoChainId}`);
  const from: EvmAccount = {
    account: source,
    asset: ousd,
    chainId: tempoChainId,
    currency: "USD",
    decimals: 6,
    network: caip2(tempoChainId) as `eip155:${number}`,
  };
  const to: EvmAccount = {
    account: payer,
    asset: destination.usdc.address,
    chainId: destination.chainId,
    currency: "USD",
    decimals: destination.usdc.decimals,
    network: destination.network,
  };
  return { from, to };
}

/**
 * The cross-chain funder for one destination (D4): exact-output funding of OUSD on Tempo to USDC at
 * the payer through Relay deposit addresses, with operations in the file store. `transfer` signs
 * the deposit with the Tempo payer (the access key, so its OUSD limit bounds every deposit).
 */
export async function crossChainFunder(options: {
  network: Network;
  destination: Destination;
  payer: Address;
  maxSpend?: bigint | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
  requestOptions: RequestOptions;
}): Promise<{ funder: CrossChainFunder; route: CrossChainRoute; source: Address }> {
  const { network, destination } = options;
  const url = relayUrl(network);
  if (!url)
    throw paymentError(
      `Cross-chain funding is unavailable on ${network.name}: Relay has no route from it. Pay with USDC the payer already holds on ${destination.name}, or use mainnet.`,
    );
  const identity = await resolvePaymentIdentity(options.requestOptions);
  const source = identity.address as Address;
  const { from, to } = accounts(network.chainId, source, destination, options.payer);
  const client = identity.getClient({ chainId: network.chainId });
  const write = (text: string) => options.stderr?.write(text);
  let waiting = false;
  const route = relayDepositRoute({
    url,
    maxGas: maxDepositGas,
    maxSpend: options.maxSpend,
    async transfer(deposit) {
      const { receipt } = await Actions.token.transferSync(
        client as never,
        {
          token: deposit.token,
          to: deposit.depositAddress,
          amount: deposit.amount,
          feeToken: deposit.token,
        } as never,
      );
      if (receipt.status !== "success") throw new FundingError("Relay deposit transfer reverted");
    },
    onProgress(event) {
      if (event.type === "submitted")
        write(
          `Bridging ${formatUnits(event.deposit.amount, 6)} OUSD to ${options.payer} on ${destination.name} via Relay (request ${event.deposit.requestId})\n`,
        );
      else if (!waiting) {
        waiting = true;
        write(`Waiting for Relay to deliver (request ${event.requestId})…\n`);
      }
    },
  });
  return {
    source,
    route,
    funder: crossChainFund({
      from,
      to,
      routes: [route],
      operations: fileStore(operationsDirectory()),
      balance: (account) => destinationBalance(destination, account.account),
      pollIntervalMs: 500,
    }),
  };
}

/**
 * Funding for paying `offer` from `payer` across chains (Phase 4), or `undefined` when it is not
 * enabled. The attempt is saved before anything moves; a rerun of the same request reuses it.
 * Before a new attempt, earlier attempts to the same destination and payer are reconciled, so a
 * slow relay never causes a second bridge.
 */
export async function crossChainFunding(
  offer: EvmOffer,
  payer: Address,
  request: FetchPlan,
  options: RequestOptions,
  stderr: Pick<NodeJS.WriteStream, "write">,
) {
  if (!crossChainEnabled(options)) return undefined;
  const network = requestNetwork(options);
  const limit = maxFundingSpend(options);
  const { funder, route, source } = await crossChainFunder({
    network,
    destination: offer.destination,
    payer,
    maxSpend: limit,
    stderr,
    requestOptions: options,
  });
  const attempt = await claimAttempt({
    fingerprint: requestFingerprint({
      method: request.init.method ?? "GET",
      url: request.url,
      body:
        typeof request.init.body === "string" ? request.init.body : JSON.stringify(options.form),
    }),
    requirementKey: requirementKey(offer.requirement),
    tempoChainId: network.chainId,
    destination: { chainId: offer.destination.chainId, name: offer.destination.name },
    payer,
    source,
    url: request.url,
  });
  if (!attempt.reused) await reconcileEarlier(attempt, route, network);
  return {
    funders: [funder],
    attemptId: attempt.attemptId,
    maxFundingSpend: [
      {
        network: caip2(network.chainId),
        asset: tempoFundingInputs(network.chainId)[0]!,
        amount: limit,
      },
    ],
    /** Forget the attempt once its funds were paid with. */
    settled: () => removeAttempt(attempt.attemptId),
  };
}

/**
 * Settles every other saved attempt to the same destination and payer before this one funds: a
 * completed or refunded operation is forgotten (its USDC, if any, now counts toward the payment),
 * one never claimed moved nothing, and one still in flight stops this payment.
 */
async function reconcileEarlier(attempt: AttemptRecord, route: CrossChainRoute, network: Network) {
  const store = fileStore(operationsDirectory());
  for (const earlier of await listAttempts()) {
    if (
      earlier.attemptId === attempt.attemptId ||
      earlier.destination.chainId !== attempt.destination.chainId ||
      earlier.payer.toLowerCase() !== attempt.payer.toLowerCase()
    )
      continue;
    const operation = await store.get(earlier.attemptId);
    if (!operation) {
      await removeAttempt(earlier.attemptId);
      continue;
    }
    const outcome = await settledOutcome(route, operation);
    if (outcome === "completed" || outcome === "refunded") {
      await removeAttempt(earlier.attemptId);
      continue;
    }
    throw fundingInFlightError(earlier.attemptId, network);
  }
}

/**
 * How an operation stands with its route, without quoting or submitting: `completed` (its USDC was
 * delivered, and may since have paid), `refunded`, or `open` (pending, needing action, or
 * unreadable).
 */
export async function settledOutcome(route: CrossChainRoute, operation: CrossChainOperation) {
  try {
    const { status } = await route.status(operation, { signal: AbortSignal.timeout(10_000) });
    return status === "completed" || status === "refunded" ? status : ("open" as const);
  } catch {
    return "open" as const;
  }
}

/** E_PAYMENT_OUTCOME_UNKNOWN for funding that may still deliver, with the recover command. */
export function fundingInFlightError(operationId: string, network: Network) {
  const command = continuationCommand(["wallet", "funding", "recover", operationId], network);
  return new CtaError(
    commandError(
      "E_PAYMENT_OUTCOME_UNKNOWN",
      `Funding operation ${operationId} may still deliver; no new funding was started. Check it with '${command}', then retry the request.`,
      command,
    ),
  );
}
