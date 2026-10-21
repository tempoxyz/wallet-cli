import { Funder } from "machine-fetch";
import { type CrossChain, CrossChainFunder } from "machine-fetch/cross-chain";
import type { Evm } from "machine-fetch/evm";
import { RelayProtocolRoute } from "machine-fetch/relay";
import { StargateRoute } from "machine-fetch/stargate";
import { FileStore } from "machine-fetch/stores/file";
import {
  type Address,
  createPublicClient,
  defineChain,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
} from "viem";

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
import { namedFetch, transactionHashes } from "../payment/upstream/delivery.js";
import { requirementKey } from "../payment/upstream/requirement-key.js";
import {
  crossChainSources,
  type Destination,
  destination as destinationFor,
  destinationBalance,
  destinationDelivery,
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
  const from: Evm.TokenAccount = {
    owner: source,
    asset,
    chainId: tempoChainId,
    currency: "USD",
    decimals: 6,
    network: caip2(tempoChainId) as `eip155:${number}`,
  };
  const to: Evm.TokenAccount = {
    owner: payer,
    asset: destination.usdc.address,
    chainId: destination.chainId,
    currency: "USD",
    decimals: destination.usdc.decimals,
    network: destination.network,
  };
  return { from, to };
}

/** A viem client machine-fetch's routes read through, and sign with when it has an account. */
type RouteClient = Evm.Client;

/**
 * Relay and Stargate through machine-fetch's own routes, from `asset` on Tempo to USDC on
 * `destination`. With `client`, a Tempo client whose account is the funding account (the access
 * key, so its token limits bound every bridge), the routes can sign; without one they can quote
 * and report status but never send. Both refuse a quote the source account cannot cover before
 * anything is signed, and the CLI's progress lines wrap their `submit` and `status`.
 */
export function fundingRoutes(options: {
  network: Network;
  asset: Address;
  destination: Destination;
  client?: RouteClient | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
  payer?: Address | undefined;
  symbol?: string | undefined;
}): CrossChain.Route[] {
  const { network, asset, destination } = options;
  const symbol = options.symbol ?? tokenSymbol(asset, network.chainId) ?? asset;
  const write = (text: string) => options.stderr?.write(text);
  const clients = {
    [network.chainId]: options.client ?? (createTempoPublicClient(network.chainId) as RouteClient),
    [destination.chainId]: destinationClient(destination) as RouteClient,
  };
  // Read balances without the signing account: an eth_call from an access key the chain has not
  // published yet (a fresh login's, until its first payment) fails with KeyNotFound.
  const reader = createTempoPublicClient(network.chainId);
  const balance = (account: Evm.TokenAccount) =>
    reader.readContract({
      address: account.asset as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.owner as Address],
    });
  const to = `${options.payer ?? "the payer"} on ${destination.name}`;
  const routes: CrossChain.Route[] = [];
  const url = relayUrl(network);
  if (url) {
    const depository = relayDepository(network.chainId);
    routes.push(
      withProgress(
        RelayProtocolRoute.create({
          name: "relay",
          url,
          fetch: namedFetch("Relay", globalThis.fetch),
          clients,
          ...(depository ? { depositories: { [network.chainId]: depository } } : {}),
          balance,
        }),
        {
          submitted: (quote, reference) =>
            `Bridging ${formatUnits(quote.amountIn, 6)} ${symbol} to ${to} via Relay (request ${reference})\n`,
          pending: (reference) => `Waiting for Relay to deliver (request ${reference})…\n`,
        },
        write,
      ),
    );
  }
  const stargate = stargateConfig(network.chainId);
  const endpointId = stargate?.endpointIds[String(destination.chainId)];
  if (stargate && endpointId && stargate.token.toLowerCase() === asset.toLowerCase()) {
    routes.push(
      withProgress(
        StargateRoute.create({
          name: "stargate",
          oft: stargate.oft,
          token: stargate.token,
          feeWrapper: stargate.feeWrapper,
          endpointIds: { [destination.chainId]: endpointId },
          destinationTokens: { [destination.chainId]: destination.usdc.address },
          clients,
          balance,
          fetch: namedFetch("LayerZero Scan", globalThis.fetch),
          ...(process.env.TEMPO_LAYERZERO_SCAN_URL
            ? { scanUrl: process.env.TEMPO_LAYERZERO_SCAN_URL }
            : {}),
        }),
        {
          submitted: (quote, reference) => {
            const fee = quote.fees.find((entry) => entry.kind === "provider")?.amount ?? 0n;
            return `Bridging ${formatUnits(quote.amountIn - fee, 6)} ${symbol} (plus ${formatUnits(fee, 6)} LayerZero fee) to ${to} via Stargate (tx ${reference})\n`;
          },
          pending: (reference) => `Waiting for Stargate to deliver (tx ${reference})…\n`,
        },
        write,
      ),
    );
  }
  return routes;
}

/** `route`, writing a line once it submits and the first time it reports pending. */
function withProgress<quote extends CrossChain.BoundedQuote>(
  route: CrossChain.Route<quote>,
  lines: {
    submitted: (quote: quote, reference: string) => string;
    pending: (reference: string) => string;
  },
  write: (text: string) => void,
): CrossChain.Route<quote> {
  let waiting = false;
  return {
    ...route,
    async submit(input) {
      const result = await route.submit(input);
      write(lines.submitted(input.quote, result.reference));
      return result;
    },
    async status(operation, context) {
      const result = await route.status(operation, context);
      if (result.status === "pending" && !waiting) {
        waiting = true;
        write(lines.pending(operation.reference ?? operation.quote.reference));
      }
      return result;
    },
  };
}

/**
 * A read-only client for `destination`'s RPC, where routes confirm deliveries. machine-fetch
 * checks that a client is on the chain it is keyed by, so it carries that chain.
 */
function destinationClient(destination: Destination) {
  return createPublicClient({
    chain: defineChain({
      id: destination.chainId,
      name: destination.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [destination.rpcUrl] } },
    }),
    transport: http(destination.rpcUrl, { retryCount: 1 }),
  });
}

/**
 * How the funder confirms a delivery on `destination`, independently of the bridge: the payer's
 * USDC balance, polled until it covers the need, and for recovery, what each destination
 * transaction the route names transferred to the payer, which still shows a delivery a payment
 * has already spent.
 */
export function deliveryReaders(destination: Destination) {
  return {
    balance: (account: Evm.TokenAccount) => destinationBalance(destination, account.owner),
    delivered: ({ account, transaction }: { account: Evm.TokenAccount; transaction: string }) => {
      const [hash] = transactionHashes(transaction);
      if (!hash) throw new Funder.FundingError("Destination transaction hash is malformed");
      return destinationDelivery(destination, hash, account.owner);
    },
  };
}

/** The route `operation` was submitted through, rebuilt without a signer, for reconciliation. */
export function operationRoute(operation: CrossChain.Operation, network: Network) {
  const destination = destinationFor(network.chainId, operation.request.to.chainId);
  if (!destination) return undefined;
  const route = fundingRoutes({
    network,
    asset: operation.request.from.asset as Address,
    destination,
  }).find((candidate) => candidate.name === operation.route);
  return route && { route, destination };
}

/**
 * How `operation` stands with its route, without quoting or submitting: a `completed` status
 * counts only once machine-fetch's `recover` confirms the delivery on the destination chain within
 * `seconds`, and is `pending` until then. Rejects when the route cannot report.
 */
export async function operationStatus(
  { route, destination }: NonNullable<ReturnType<typeof operationRoute>>,
  operation: CrossChain.Operation,
  seconds: number,
): Promise<CrossChain.Status["status"]> {
  const { status } = await route.status(operation, { signal: AbortSignal.timeout(seconds * 1000) });
  if (status !== "completed") return status;
  const funder = CrossChainFunder.create({
    from: operation.request.from,
    to: operation.request.to,
    routes: [route],
    operations: FileStore.create(operationsDirectory()),
    ...deliveryReaders(destination),
    pollIntervalMs: 500,
  });
  return funder
    .recover(operation.id, { deadlineSeconds: seconds })
    .then(() => "completed" as const)
    .catch(() => "pending" as const);
}

/**
 * `source`'s balance of each cross-chain source token on Tempo, unreadable as zero, with the
 * token's listed symbol, else its on-chain `symbol()`, else its address.
 */
export async function sourceBalances(network: Network, source: Address) {
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
 * The source tokens worth quoting for a destination shortfall of `needed`: any, when the payer
 * already holds the USDC and nothing is bridged; otherwise those covering a rough lower bound on
 * any route's input, the output plus 1%.
 */
export function bridgeableSources<entry extends { balance: bigint }>(
  balances: readonly entry[],
  needed: bigint,
) {
  if (needed === 0n) return [...balances];
  const floor = needed + needed / 100n;
  return balances.filter((entry) => entry.balance >= floor);
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
}): Promise<{ funders: CrossChainFunder.CrossChainFunder[]; sources: Address[] }> {
  const { network, destination, identity } = options;
  const source = identity.address as Address;
  const client = identity.getClient({ chainId: network.chainId });
  const balances = await sourceBalances(network, source);
  // A resumed operation reconciles from the token it was submitted in, whatever it holds now.
  const resume = options.resumeAsset?.toLowerCase();
  const usable = resume
    ? balances.filter((entry) => entry.asset.toLowerCase() === resume)
    : bridgeableSources(balances, options.needed);
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
    return CrossChainFunder.create({
      from,
      to,
      routes: fundingRoutes({
        network,
        asset,
        destination,
        client: client as unknown as RouteClient,
        stderr: options.stderr,
        payer: options.payer,
        symbol,
      }),
      operations: FileStore.create(operationsDirectory()),
      ...deliveryReaders(destination),
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
  const store = FileStore.create(operationsDirectory());
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
  const store = FileStore.create(operationsDirectory());
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
 * How an operation stands, without quoting or submitting: `completed` (its USDC was delivered,
 * and may since have paid), `refunded`, or `open` (pending, needing action, or unreadable).
 */
export async function settledOutcome(
  route: NonNullable<ReturnType<typeof operationRoute>>,
  operation: CrossChain.Operation,
) {
  const status = await operationStatus(route, operation, 10).catch(() => "open" as const);
  return status === "completed" || status === "refunded" ? status : ("open" as const);
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
