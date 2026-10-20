import { FundingError } from "machine-fetch";
import { crossChainFund } from "machine-fetch/funders/cross-chain";
import type {
  CrossChainFunder,
  CrossChainOperation,
  CrossChainRoute,
  EvmAccount,
} from "machine-fetch/interfaces/evm";
import { fileStore } from "machine-fetch/stores/file";
import { type Address, erc20Abi, formatUnits, type Hex, parseUnits } from "viem";
import { getTransactionReceipt, sendTransactionSync } from "viem/actions";

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
import { stargateRoute } from "../payment/upstream/stargate-route.js";
import {
  crossChainSources,
  type Destination,
  destination as destinationFor,
  destinationBalance,
  relayDepository,
  stargateConfig,
} from "../shared/chains.js";
import { commandError, paymentError } from "../shared/errors.js";
import { createTempoPublicClient, type Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { tokenSymbol } from "../shared/tokens.js";
import type { FetchPlan } from "./fetch.js";
import { fundingSetting } from "./funding-mode.js";
import { requestNetwork, resolvePaymentIdentity } from "./identity.js";
import type { EvmOffer } from "./offers.js";
import type { RequestOptions } from "./options.js";
import { spendCap } from "./spend.js";

/** Most a bridge's Tempo-side transaction fee may cost, in the source token: 0.02. */
export const maxDepositGas = 20_000n;

/**
 * The cap on one cross-chain funding operation's source-token spend, bridge fees and gas included:
 * `--max-funding-spend`, else `--max-spend` plus 5% and 0.10.
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

/** The Tempo-side account funding spends `asset` from, and the payer's USDC on `destination`. */
export function fundingAccounts(
  tempoChainId: number,
  source: Address,
  asset: Address,
  destination: Destination,
  payer: Address,
) {
  const from: EvmAccount = {
    account: source,
    asset,
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

type Signer = {
  sendCalls(calls: readonly { to: Address; data: Hex }[], feeToken: Address): Promise<Hex>;
};

/**
 * The bridges that fund `asset` on Tempo into USDC on `destination`, by route name: Relay (a
 * contract deposit into its pinned depository where one is configured, else a strict deposit
 * address) for any source token, and Stargate for the token its OFT bridges. With no `signer`
 * (reconciliation) the routes can quote and report status but never send.
 */
export function fundingRoutes(options: {
  network: Network;
  asset: Address;
  destination: Destination;
  signer?: Signer | undefined;
  maxSpend?: bigint | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
  payer?: Address | undefined;
  symbol?: string | undefined;
}): CrossChainRoute[] {
  const { network, asset, destination } = options;
  const symbol = options.symbol ?? tokenSymbol(asset, network.chainId) ?? asset;
  const write = (text: string) => options.stderr?.write(text);
  const send = async (calls: readonly { to: Address; data: Hex }[]) => {
    if (!options.signer) throw new FundingError("Reconciliation never sends funding");
    return options.signer.sendCalls(calls, asset);
  };
  const routes: CrossChainRoute[] = [];
  // Both routes refuse a quote the source account cannot cover, before anything is signed.
  const sourceClient = createTempoPublicClient(network.chainId);
  const balance = (request: { from: { account: Address; asset: Address } }) =>
    sourceClient.readContract({
      address: request.from.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [request.from.account],
    });
  const url = relayUrl(network);
  if (url) {
    let waiting = false;
    routes.push(
      relayDepositRoute({
        url,
        depository: relayDepository(network.chainId),
        maxGas: maxDepositGas,
        maxSpend: options.maxSpend,
        balance,
        async execute(deposit) {
          await send(deposit.calls);
        },
        onProgress(event) {
          if (event.type === "submitted")
            write(
              `Bridging ${formatUnits(event.deposit.amount, 6)} ${symbol} to ${options.payer ?? "the payer"} on ${destination.name} via Relay (request ${event.deposit.requestId})\n`,
            );
          else if (!waiting) {
            waiting = true;
            write(`Waiting for Relay to deliver (request ${event.requestId})…\n`);
          }
        },
      }),
    );
  }
  const stargate = stargateConfig(network.chainId);
  if (
    stargate &&
    stargate.token.toLowerCase() === asset.toLowerCase() &&
    stargate.endpointIds[String(destination.chainId)]
  ) {
    const client = createTempoPublicClient(network.chainId);
    let waiting = false;
    routes.push(
      stargateRoute({
        ...stargate,
        destinationToken: (chainId) => destinationFor(network.chainId, chainId)?.usdc.address,
        client: client as never,
        maxGas: maxDepositGas,
        maxSpend: options.maxSpend,
        balance,
        ...(process.env.TEMPO_LAYERZERO_SCAN_URL
          ? { scanUrl: process.env.TEMPO_LAYERZERO_SCAN_URL }
          : {}),
        execute: send,
        async reverted(hash) {
          const receipt = await getTransactionReceipt(client, { hash }).catch(() => undefined);
          return receipt ? receipt.status === "reverted" : undefined;
        },
        onProgress(event) {
          if (event.type === "submitted")
            write(
              `Bridging ${formatUnits(event.amount, 6)} ${symbol} (plus ${formatUnits(event.fee, 6)} LayerZero fee) to ${options.payer ?? "the payer"} on ${destination.name} via Stargate (tx ${event.hash})\n`,
            );
          else if (!waiting) {
            waiting = true;
            write(`Waiting for Stargate to deliver (tx ${event.hash})…\n`);
          }
        },
      }),
    );
  }
  return routes;
}

/** The route `operation` was submitted through, rebuilt without a signer, for reconciliation. */
export function operationRoute(operation: CrossChainOperation, network: Network) {
  const destination = destinationFor(network.chainId, operation.request.to.chainId);
  if (!destination) return undefined;
  return fundingRoutes({
    network,
    asset: operation.request.from.asset as Address,
    destination,
  }).find((route) => route.name === operation.route);
}

/**
 * `source`'s balance of each cross-chain source token on Tempo, unreadable as zero, with the
 * token's listed symbol, else its on-chain `symbol()`, else its address.
 */
async function sourceBalances(network: Network, source: Address) {
  const client = createTempoPublicClient(network.chainId);
  return Promise.all(
    crossChainSources(network.chainId).map(async (asset) => ({
      asset,
      balance: await client
        .readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [source] })
        .catch(() => 0n),
      symbol:
        tokenSymbol(asset, network.chainId) ??
        (await client
          .readContract({ address: asset, abi: erc20Abi, functionName: "symbol" })
          .then((value) => (/^[\w.$-]{1,16}$/.test(value) ? value : asset))
          .catch(() => asset)),
    })),
  );
}

/**
 * The cross-chain funders for one destination (D4), one per source token the Tempo account holds
 * enough of to plausibly cover `needed`, in preference order. machine-fetch quotes every route of
 * the first funder and executes the cheapest; operations persist in the file store. Funding signs
 * with the Tempo payer (the access key, so its token limits bound every bridge).
 */
export async function crossChainFunders(options: {
  network: Network;
  destination: Destination;
  payer: Address;
  needed: bigint;
  /** The source token of a saved operation this attempt resumes: it must fund from that token. */
  resumeAsset?: Address | undefined;
  maxSpend?: bigint | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
  identity: Awaited<ReturnType<typeof resolvePaymentIdentity>>;
}): Promise<{ funders: CrossChainFunder[]; sources: Address[] }> {
  const { network, destination, identity } = options;
  const source = identity.address as Address;
  const client = identity.getClient({ chainId: network.chainId });
  const signer: Signer = {
    async sendCalls(calls, feeToken) {
      const receipt = await sendTransactionSync(
        client as never,
        {
          account: (client as { account?: unknown }).account,
          calls: calls.map((call) => ({ to: call.to, data: call.data })),
          feeToken,
        } as never,
      );
      const { status, transactionHash } = receipt as { status: string; transactionHash: Hex };
      if (status !== "success") throw new FundingError("Funding transaction reverted");
      return transactionHash;
    },
  };
  const balances = await sourceBalances(network, source);
  // A resumed operation reconciles from the token it was submitted in, whatever it holds now; when
  // the payer already holds the USDC nothing is bridged and any source will do; otherwise only
  // sources covering a rough lower bound on any route's input (the output plus 1%) are tried.
  const resume = options.resumeAsset?.toLowerCase();
  const floor = options.needed + options.needed / 100n;
  const usable = resume
    ? balances.filter((entry) => entry.asset.toLowerCase() === resume)
    : options.needed === 0n
      ? balances
      : balances.filter((entry) => entry.balance >= floor);
  if (usable.length === 0) {
    const held = balances
      .map((entry) => `${formatUnits(entry.balance, 6)} ${entry.symbol}`)
      .join(", ");
    const command = continuationCommand(["wallet", "fund"], network);
    throw new CtaError(
      commandError(
        "E_INSUFFICIENT_FUNDS",
        `Bridging ${formatUnits(options.needed, 6)} USDC to ${destination.name} needs more than the wallet holds (${held || "no bridgeable tokens"}). Add funds with '${command}', then retry.`,
        command,
      ),
    );
  }
  const funders = usable.map(({ asset, symbol }) => {
    const { from, to } = fundingAccounts(
      network.chainId,
      source,
      asset,
      destination,
      options.payer,
    );
    return crossChainFund({
      from,
      to,
      routes: fundingRoutes({
        network,
        asset,
        destination,
        signer,
        maxSpend: options.maxSpend,
        stderr: options.stderr,
        payer: options.payer,
        symbol,
      }),
      operations: fileStore(operationsDirectory()),
      balance: (account) => destinationBalance(destination, account.account),
      pollIntervalMs: 500,
    });
  });
  return { funders, sources: usable.map((entry) => entry.asset) };
}

/**
 * Funding for paying `offer` from `payer` across chains (Phase 4), or `undefined` when it is not
 * enabled. The attempt is saved before anything moves; a rerun of the same request reuses it.
 * Before a new attempt, earlier attempts to the same destination and payer are reconciled, so a
 * slow bridge never causes a second one.
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
  if (!relayUrl(network) && !stargateConfig(network.chainId))
    throw paymentError(
      `Cross-chain funding is unavailable on ${network.name}: no bridge routes from it. Pay with USDC the payer already holds on ${offer.destination.name}, or use mainnet.`,
    );
  const limit = maxFundingSpend(options);
  const identity = await resolvePaymentIdentity(options);
  const source = identity.address as Address;
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
  const store = fileStore(operationsDirectory());
  /**
   * Forgets the attempt when funding failed before anything moved: no operation was claimed for
   * it, so there is nothing to reconcile, and keeping it would only clutter `funding list`. An
   * attempt with an operation is always kept for recovery.
   */
  const abandon = async () => {
    const operation = await Promise.resolve()
      .then(() => store.get(attempt.attemptId))
      .catch(() => "unknown" as const);
    if (operation === undefined) await removeAttempt(attempt.attemptId);
  };
  const resumed = attempt.reused ? await store.get(attempt.attemptId) : undefined;
  const held = await destinationBalance(offer.destination, payer).catch(() => 0n);
  const needed = offer.requirement.amount > held ? offer.requirement.amount - held : 0n;
  let prepared: Awaited<ReturnType<typeof crossChainFunders>>;
  try {
    prepared = await crossChainFunders({
      network,
      destination: offer.destination,
      payer,
      needed,
      resumeAsset: resumed?.request.from.asset as Address | undefined,
      maxSpend: limit,
      stderr,
      identity,
    });
    if (!attempt.reused) await reconcileEarlier(attempt, network);
  } catch (error) {
    await abandon().catch(() => undefined);
    throw error;
  }
  const { funders, sources } = prepared;
  return {
    funders,
    attemptId: attempt.attemptId,
    abandon,
    maxFundingSpend: sources.map((asset) => ({
      network: caip2(network.chainId),
      asset,
      amount: limit,
    })),
    /** Forget the attempt once its funds were paid with. */
    settled: () => removeAttempt(attempt.attemptId),
  };
}

/**
 * Settles every other saved attempt to the same destination and payer before this one funds: a
 * completed or refunded operation is forgotten (its USDC, if any, now counts toward the payment),
 * one never claimed moved nothing, and one still in flight stops this payment.
 */
async function reconcileEarlier(attempt: AttemptRecord, network: Network) {
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
    const route = operationRoute(operation, network);
    const outcome = route ? await settledOutcome(route, operation) : "open";
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
