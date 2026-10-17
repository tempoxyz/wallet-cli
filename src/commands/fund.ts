import { setTimeout as sleep } from "node:timers/promises";
import { Cli } from "incur";
import { erc20Abi, formatUnits, type Address } from "viem";
import { ousd } from "viem/tokens";

import { nonDestructive, type WalletCommand } from "../cli/command.js";
import { flag, option } from "../cli/describe.js";
import { fundOptions, fundOutput, fundStatusOptions } from "../schemas/fund.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { commandError, networkError, usageError } from "../shared/errors.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import {
  appUrl,
  createTempoPublicClient,
  explicitNetwork,
  networkFields,
  parseNetwork,
  resolveNetwork,
  tokenAddress,
  tokenDecimals,
} from "../shared/network.js";
import {
  fundingAmount,
  machCheckoutMinimum,
  machFundingAmount,
  machFundingToken,
  requireWalletAddress,
} from "../shared/mach.js";
import { openExternal } from "../shared/process.js";
import { tokenSymbol } from "../shared/tokens.js";
import { formatUnixTimestamp, nowSeconds } from "../shared/utils.js";
import {
  clearPendingFund,
  loadPendingFund,
  loadWalletState,
  parsePendingFund,
  savePendingFund,
  type PendingFund,
} from "../wallet/store.js";

// Bare `tempo wallet fund` opens a funding flow; `fund status` waits for a pending one.
export default {
  command: Cli.create("fund", {
    description: "Open add-funds flows in the wallet app",
    globals: cliGlobals,
    options: fundOptions,
    alias: globalAlias,
    output: fundOutput,
    async run({ error, globals, options }) {
      const result = await runFundingFlow({
        action: fundAction({
          credits: options.credits,
          mach: options.mach,
          crypto: options.crypto,
          referralCode: options["referral-code"],
        }),
        address: options.address,
        code: options["referral-code"],
        noBrowser: options.browser === false,
        noWait: options.wait === false,
        amount: options.amount,
        timeout: options.timeout,
        network: globals.network,
      });
      return "code" in result ? error(result) : result;
    },
  }).command("status", {
    description: "Wait for a pending funding's balance increase",
    options: fundStatusOptions,
    alias: globalAlias,
    output: fundOutput,
    async run({ error, globals, options }) {
      const result = await fundStatusHandler({
        network: globals.network,
        interval: options.interval,
        maxAttempts: options["max-attempts"],
      });
      return "code" in result ? error(result) : result;
    },
  }),
  annotations: {
    // Opens a wallet-app checkout and saves it for `fund status`; any payment happens in the
    // wallet app, not in this command.
    fund: { ...nonDestructive, idempotentHint: false, openWorldHint: true },
    // Reads balances and clears the pending funding once it arrives or expires; reruns add nothing.
    fund_status: { ...nonDestructive, idempotentHint: true, openWorldHint: true },
  },
  describe: {
    name: "fund",
    about: "Open add-funds flows in the wallet app",
    args: [
      option("address", "--address", "Wallet address to fund (defaults to current wallet)", {
        valueName: "ADDRESS",
      }),
      flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
      flag(
        "crypto",
        "--crypto",
        "Open the direct crypto funding flow (bridge on mainnet, faucet on testnet)",
      ),
      flag("mach", "--mach", "Open MACH funding"),
      flag("credits", "--credits", "Unavailable; use --mach to buy MACH"),
      option("amount", "--amount", "USD amount to prefill", { valueName: "AMOUNT" }),
      flag("wait", "--wait", "Wait for a balance increase; otherwise return immediately"),
      flag("no_wait", "--no-wait", "Return the funding handoff immediately (default)"),
      option("timeout", "--timeout", "Timeout in seconds with --wait (default: 600)", {
        valueName: "SECONDS",
      }),
      option("referral_code", "--referral-code", "Referral code to claim while funding", {
        valueName: "CODE",
      }),
    ],
    subcommands: [
      {
        name: "status",
        about: "Wait for a pending funding's balance increase",
        args: [
          option("interval", "--interval", "Seconds between balance checks", {
            valueName: "SECONDS",
          }),
          option("max_attempts", "--max-attempts", "Checks before giving up", {
            valueName: "COUNT",
          }),
        ],
      },
    ],
  },
  retiredFlags: [
    {
      flag: "--claim",
      takesValue: true,
      mcp: true,
      // `--referral-code` won over `--claim`, so with both the run is the same without `--claim`.
      replacement: ({ args, value }) => ({
        message:
          "--claim was removed; pass the referral code with --referral-code: 'tempo wallet fund --referral-code <code>'.",
        argv:
          value === undefined
            ? undefined
            : [
                "fund",
                ...args,
                ...(args.some(
                  (arg) => arg === "--referral-code" || arg.startsWith("--referral-code="),
                )
                  ? []
                  : ["--referral-code", value]),
              ],
      }),
    },
  ],
} satisfies WalletCommand;

export type FundAction = "fund" | "mach" | "crypto" | "credits" | "claim";

/** How long `fund status` can resume a funding: long enough for a card or bridge checkout. */
const pendingFundSeconds = 3600;

/** The `fund status` a pending funding's `_next` and a timed-out wait name. */
const statusIntervalSeconds = 5;
const resumeArgv = ["wallet", "fund", "status", "--interval", String(statusIntervalSeconds)];

/**
 * Opens a wallet funding flow and saves it as the pending funding, with the starting balance of
 * each token the flow can deliver. By default returns at once with a `_next` to `fund status`;
 * with `noWait: false`, waits here. The link is printed before any RPC read, so a failing RPC never
 * hides it: without a starting balance the handoff is still returned, but cannot be resumed. The
 * browser opens only after that read.
 */
export async function runFundingFlow(options: {
  action: FundAction;
  address?: string | undefined;
  amount?: string | undefined;
  code?: string | undefined;
  network?: string | undefined;
  noBrowser?: boolean | undefined;
  noWait?: boolean | undefined;
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
}) {
  if (options.action === "credits") throw creditsFundingError();
  const action = options.action;
  const state = await loadWalletState();
  const network = await resolveNetwork(options.network, state);
  const chain = network.chainId;
  const assets = fundingAssets(action, chain, options.amount);
  const address = options.address ?? state.accounts[state.activeAccount ?? 0]?.address;
  if (!address && action !== "claim")
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  const wallet = address ? requireWalletAddress(address) : null;
  const url = fundUrl(action, {
    address: wallet ?? undefined,
    amount: options.amount,
    chainId: chain,
    code: options.code,
  });
  const wait = options.noWait === false && wallet ? waitSettings(options.timeout) : undefined;

  console.error(`Open this link on your device: ${url}`);
  // This funding replaces the pending one, even when it cannot be resumed itself.
  await clearPendingFund();
  const open = () => {
    if (!options.noBrowser) openExternal(url);
  };
  const handoff = {
    status: "pending" as const,
    wallet,
    action,
    url,
    ...networkFields(chain),
    token: assets[0]!.token,
    // Every watched token has a symbol, so it is never rendered as null.
    symbol: assets[0]!.symbol,
    amount: options.amount ?? null,
    balance: null,
    raw_balance: null,
  };
  if (!wallet) {
    open();
    return handoff;
  }

  // The flow opens after the read, so funds it delivers quickly are not in the starting balance.
  // `--timeout` bounds the whole wait, starting balance read included; the read keeps its own
  // RPC bound, so a `--timeout` shorter than it still saves a funding `fund status` can resume.
  const deadline = Date.now() + (wait?.timeoutMs ?? 0);
  const baselines = await readBalances(
    chain,
    wallet,
    assets.map((asset) => asset.token),
    AbortSignal.timeout(10_000),
  ).catch(() => undefined);
  open();
  if (!baselines) {
    // `whoami` reads only the logged-in wallet, so it cannot check an `--address` recipient.
    const whoami = options.address
      ? undefined
      : continuationCommand(
          ["wallet", "whoami", ...(action === "mach" ? ["--mach"] : [])],
          network,
        );
    const check = whoami ? `the balance with '${whoami}'` : `the balance of ${wallet}`;
    const message = `Could not read the wallet's starting balance (check TEMPO_RPC_URL), so 'tempo wallet fund status' cannot tell when funds arrive. Finish funding at ${url}, then check ${check}.`;
    if (wait && whoami) return commandError("E_NETWORK", message, whoami);
    if (wait) throw networkError(message);
    console.error(message);
    return { ...handoff, instruction: message };
  }

  const pending = parsePendingFund({
    network: network.name,
    action,
    wallet,
    activeWallet: !options.address,
    url,
    amount: options.amount ?? null,
    assets: assets.map((asset, index) => ({
      token: asset.token,
      symbol: asset.symbol,
      baseline: baselines[index]!.toString(),
      minimum: asset.minimum.toString(),
    })),
    expiresAt:
      nowSeconds() + Math.max(pendingFundSeconds, Math.ceil((wait?.timeoutMs ?? 0) / 1000)),
  });
  // A logout during the read must not leave the logged-out wallet's checkout for the next login.
  if (pending.activeWallet && (await activeWallet()) !== wallet)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  await savePendingFund(pending);
  if (!wait)
    return {
      ...handoff,
      ...nextStep(
        "Have the user open url and finish funding. Then run the next command to wait for the funds to arrive.",
        resumeArgv,
        { network, until: '.status != "pending"', pollIntervalSeconds: statusIntervalSeconds },
      ),
    };

  console.error(`Waiting for ${action === "mach" ? "MACH" : "funding"}...`);
  return await finishFunding(pending, {
    intervalMs: wait.intervalMs,
    timeoutMs: Math.max(0, deadline - Date.now()),
    signal: options.signal,
    status: resumeArgv,
  });
}

type StatusOptions = {
  /** Seconds between balance checks; defaults to `TEMPO_WALLET_FUND_POLL_MS`, or 2 seconds. */
  interval?: number | undefined;
  /** Checks that may find no funds before giving up; defaults to until the funding expires. */
  maxAttempts?: number | undefined;
};

/** Resumes waiting on the pending funding until its funds arrive, it expires, or out of attempts. */
export async function fundStatusHandler(
  options: { network?: string | undefined; signal?: AbortSignal | undefined } & StatusOptions,
) {
  let pending = await loadPendingFund();
  // A funding for the logged-in wallet ends once a logout, login, or refresh switches wallets, so
  // the next wallet never sees its checkout.
  if (pending?.activeWallet && (await activeWallet()) !== pending.wallet) {
    await clearPendingFund(pending);
    pending = undefined;
  }
  const requested = explicitNetwork(options.network);
  if (!pending || (requested && requested.name !== pending.network)) {
    const network = requested ?? (await resolveNetwork(undefined));
    const command = continuationCommand(["wallet", "fund"], network);
    return commandError(
      "E_USAGE",
      `No funding is pending on ${network.name}. Run '${command}' to start one.`,
      command,
    );
  }
  return await finishFunding(pending, {
    intervalMs:
      options.interval === undefined
        ? pollInterval()
        : finiteDuration(options.interval * 1000, "--interval"),
    timeoutMs: Math.max(0, pending.expiresAt * 1000 - Date.now()),
    maxAttempts: options.maxAttempts,
    signal: options.signal,
    status: [
      "wallet",
      "fund",
      "status",
      ...(options.interval !== undefined ? ["--interval", String(options.interval)] : []),
      ...(options.maxAttempts !== undefined ? ["--max-attempts", String(options.maxAttempts)] : []),
    ],
  });
}

type PollOptions = {
  intervalMs: number;
  /** How long this process waits; reaching it after the funding expires ends the funding. */
  timeoutMs: number;
  maxAttempts?: number | undefined;
  signal?: AbortSignal | undefined;
  /** The `fund status` argv that resumes this wait. */
  status: readonly string[];
};

/**
 * Waits for `pending` to arrive and reports how the wait ended. Every outcome but arrival and
 * expiry keeps the pending funding, with a `cta` to the `fund status` that resumes it.
 */
async function finishFunding(pending: PendingFund, options: PollOptions) {
  const expired = () => nowSeconds() >= pending.expiresAt;
  let result = await pollFunding(pending, options);
  // Expiry ends the funding only once a completed read shows the funds have not arrived.
  if (result === "timeout" && expired())
    result = await pollFunding(pending, { ...options, timeoutMs: 10_000, maxAttempts: 1 });
  const network = parseNetwork(pending.network);
  const status = continuationCommand(options.status, network);
  const resume = `Continue at ${pending.url}, then run '${status}' to keep waiting.`;
  if (result === "network")
    return commandError(
      "E_NETWORK",
      `Could not read the wallet's balance (check TEMPO_RPC_URL). ${resume}`,
      status,
      { retryable: true },
    );
  if (result === "cancelled")
    return commandError("E_POLL_TIMEOUT", `Funding wait cancelled. ${resume}`, status);
  if (result === "timeout")
    return commandError("E_POLL_TIMEOUT", `Timed out waiting for funding. ${resume}`, status);
  if (result === "exhausted" && !expired())
    return commandError("E_POLL_TIMEOUT", `Funding has not arrived yet. ${resume}`, status);

  await clearPendingFund(pending);
  if (result === "exhausted") {
    const restart = continuationCommand(restartArgv(pending), network);
    // `whoami` reads only the logged-in wallet, so it cannot check an `--address` recipient.
    const check = pending.activeWallet
      ? `the balance with 'tempo wallet whoami'`
      : `the balance of ${pending.wallet}`;
    return commandError(
      "E_POLL_TIMEOUT",
      `No funds arrived before the funding expired at ${formatUnixTimestamp(pending.expiresAt)}. Check ${check}, or run '${restart}' to start a new funding.`,
      restart,
      { retryable: false },
    );
  }
  const asset = pending.assets[result.asset]!;
  return {
    status: "success" as const,
    wallet: pending.wallet,
    action: pending.action,
    url: pending.url,
    ...networkFields(network.chainId),
    token: asset.token,
    symbol: asset.symbol,
    amount: pending.amount,
    balance: formatUnits(result.balance, tokenDecimals()),
    raw_balance: result.balance.toString(),
  };
}

/** The logged-in wallet's lowercase address, if any. */
async function activeWallet() {
  const state = await loadWalletState();
  return state.accounts[state.activeAccount ?? 0]?.address.toLowerCase();
}

/** The `fund` that starts `pending` again: the same flow, wallet, amount, and referral code. */
function restartArgv(pending: PendingFund) {
  const code = new URL(pending.url).searchParams.get("claim");
  return [
    "wallet",
    "fund",
    ...(pending.action === "mach" || pending.action === "crypto" ? [`--${pending.action}`] : []),
    ...(pending.action === "claim" && code ? ["--referral-code", code] : []),
    // A logged-in wallet's funding restarts for that wallet, keeping its logged-in binding.
    ...(pending.activeWallet ? [] : ["--address", pending.wallet]),
    ...(pending.amount !== null ? ["--amount", pending.amount] : []),
  ];
}

/** The asset whose increase reached its minimum, or why polling stopped without one. */
async function pollFunding(
  pending: PendingFund,
  options: PollOptions,
): Promise<{ asset: number; balance: bigint } | "exhausted" | "network" | "timeout" | "cancelled"> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Funding wait cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(options.timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const chain = parseNetwork(pending.network).chainId;
  const tokens = pending.assets.map((asset) => asset.token);
  try {
    for (let attempt = 1; ; attempt++) {
      const balances = await readBalances(chain, pending.wallet, tokens, signal, options.timeoutMs);
      const asset = pending.assets.findIndex(
        (item, index) => balances[index]! - BigInt(item.baseline) >= BigInt(item.minimum),
      );
      if (asset >= 0) return { asset, balance: balances[asset]! };
      if (attempt >= (options.maxAttempts ?? Infinity)) return "exhausted";
      await sleep(options.intervalMs, undefined, { signal });
    }
  } catch {
    if (!signal.aborted) return "network";
    return signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

type FundingAsset = { token: Address; symbol: string; minimum: bigint };

/**
 * The tokens a funding flow can deliver to the wallet, each with the raw balance increase that
 * counts as the funding arriving, so an unrelated small transfer does not. MACH checkout mints
 * exactly the amount bought, and at least $5. Card onramps take their fees out of the purchase
 * amount, so stablecoin funding counts from 95% of `--amount`, as the wallet app's own deposit
 * check does. Without `--amount` the wallet UI picks the amount, so stablecoin funding counts from
 * $1, which a dust or address-poisoning transfer does not reach.
 */
function fundingAssets(
  action: Exclude<FundAction, "credits">,
  chain: number,
  amount: string | undefined,
): FundingAsset[] {
  if (action === "mach")
    return [
      {
        token: machFundingToken(chain),
        symbol: "MACH",
        minimum: machFundingAmount(amount) ?? machCheckoutMinimum,
      },
    ];
  const raw = fundingAmount(amount);
  const minimum = raw === undefined ? 1_000_000n : (raw * 95n) / 100n || 1n;
  return stablecoins(action, chain).map((token) => ({
    token,
    symbol: tokenSymbol(token, chain) ?? token,
    minimum,
  }));
}

/**
 * Where each stablecoin flow settles. On mainnet, card onramps and bridged deposits settle OUSD,
 * and MoonPay settles USDC.e. A referral claim pays USDC.e, and testnet funding pays pathUSD.
 */
function stablecoins(action: "fund" | "crypto" | "claim", chain: number) {
  if (chain !== 4217 || action === "claim") return [tokenAddress(chain)];
  return [ousd.addresses[4217].toLowerCase() as Address, tokenAddress(chain)];
}

/** Raw balances of `tokens` for `wallet`, failing once `signal` aborts. */
async function readBalances(
  chain: number,
  wallet: Address,
  tokens: readonly Address[],
  signal: AbortSignal,
  timeoutMs = 10_000,
) {
  const client = createTempoPublicClient(chain, {
    timeout: Math.min(10_000, Math.max(1, timeoutMs)),
    retryCount: 0,
  });
  return await Promise.all(
    tokens.map((token) =>
      bounded(
        client.readContract({
          abi: erc20Abi,
          address: token,
          functionName: "balanceOf",
          args: [wallet],
        }),
        signal,
      ),
    ),
  );
}

function waitSettings(timeout: number | undefined) {
  return {
    timeoutMs: finiteDuration(
      timeout === undefined
        ? Number(process.env.TEMPO_WALLET_FUND_TIMEOUT_MS ?? 600_000)
        : timeout * 1000,
      "Funding timeout",
    ),
    intervalMs: pollInterval(),
  };
}

function pollInterval() {
  return finiteDuration(
    Number(process.env.TEMPO_WALLET_FUND_POLL_MS ?? 2_000),
    "Funding poll interval",
  );
}

function finiteDuration(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
    throw usageError(`${name} must be a finite non-negative duration`);
  return value;
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function fundAction(options: {
  mach?: boolean | undefined;
  credits?: boolean | undefined;
  crypto?: boolean | undefined;
  referralCode?: string | undefined;
}): FundAction {
  if (options.credits) throw creditsFundingError();
  if (options.mach && (options.crypto || options.referralCode))
    throw usageError("--mach cannot be combined with --crypto or --referral-code");
  if (options.mach) return "mach";
  if (options.crypto) return "crypto";
  if (options.referralCode) return "claim";
  return "fund";
}

/** The wallet app's `/agent` funding page, on the same app as the rest of the CLI (`TEMPO_AUTH_URL`). */
export function fundUrl(
  action: FundAction,
  options: {
    address?: string | undefined;
    amount?: string | undefined;
    chainId?: number | undefined;
    code?: string | undefined;
  } = {},
) {
  if (action === "credits") throw creditsFundingError();
  const url = new URL("/agent", appUrl);
  if (action === "claim" && options.code) url.searchParams.set("claim", options.code);
  else {
    const mach = action === "mach";
    url.searchParams.set("action", mach ? "fund" : action);
    if (mach) {
      machFundingToken(options.chainId ?? 4217);
      url.searchParams.set("intent", "mach");
    }
  }
  if (options.address) url.searchParams.set("address", requireWalletAddress(options.address));
  if (options.chainId !== undefined) url.searchParams.set("chainId", String(options.chainId));
  if (options.amount !== undefined) {
    if (action === "mach") machFundingAmount(options.amount);
    else fundingAmount(options.amount);
    url.searchParams.set("amount", options.amount);
  }
  return url.toString();
}

function creditsFundingError() {
  return usageError(
    "MPP Credits can no longer be purchased. Use 'tempo wallet fund --mach' to buy MACH instead.",
  );
}
