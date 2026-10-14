import { setTimeout as sleep } from "node:timers/promises";
import { erc20Abi, formatUnits } from "viem";

import { usageError, walletError } from "../shared/errors.js";
import {
  appUrl,
  createTempoPublicClient,
  networkFields,
  resolveNetwork,
  tokenAddress,
  tokenSymbol,
} from "../shared/network.js";
import {
  fundingAmount,
  machFundingAmount,
  machFundingToken,
  requireWalletAddress,
} from "../shared/mach.js";
import { nextStep } from "../shared/next.js";
import { openExternal } from "../shared/process.js";
import { loadWalletState } from "../wallet/store.js";

export type FundAction = "fund" | "mach" | "crypto" | "credits" | "claim";

/** Seconds between `_next` status checks of a pending funding handoff. */
const statusPollSeconds = 10;

/**
 * Opens a funding link, then waits until the wallet's balance of the funded token rises by
 * `amount` (any increase without one). `noWait` returns the link with a `_next` status check
 * instead. `baseline` is the raw balance a pending result recorded: it resumes that check
 * without opening the link again, once with `noWait` or until funded otherwise.
 */
export async function runFundingFlow(options: {
  action: FundAction;
  address?: string | undefined;
  amount?: string | undefined;
  baseline?: string | undefined;
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
  // A referral code pays a token and amount the CLI cannot know, so a claim is only a handoff.
  const token =
    action === "claim" ? null : action === "mach" ? machFundingToken(chain) : tokenAddress(chain);
  const requested =
    action === "mach" ? machFundingAmount(options.amount) : fundingAmount(options.amount);
  const baseline = rawBalance(options.baseline);
  const timeoutMs = finiteDuration(
    options.timeout === undefined
      ? Number(process.env.TEMPO_WALLET_FUND_TIMEOUT_MS ?? 600_000)
      : options.timeout * 1000,
    "Funding timeout",
  );
  const pollMs = finiteDuration(
    Number(process.env.TEMPO_WALLET_FUND_POLL_MS ?? 2_000),
    "Funding poll interval",
  );
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
  const base = {
    wallet,
    action,
    url,
    ...networkFields(chain),
    token,
    symbol: token ? tokenSymbol(token) : undefined,
    amount: options.amount ?? null,
  };
  const unobserved = { balance: null, raw_balance: null, received: null, raw_received: null };
  if (token === null || wallet === null) {
    if (baseline !== undefined)
      throw usageError("--baseline cannot be used with --claim or --referral-code");
    if (!options.noBrowser) openExternal(url);
    return {
      status: "pending" as const,
      ...base,
      ...unobserved,
      instruction:
        "Open the url to claim the referral code. The CLI cannot observe referral payouts; check the balance with 'tempo wallet whoami' after claiming.",
    };
  }

  const client = createTempoPublicClient(chain, {
    timeout: Math.min(10_000, Math.max(1, timeoutMs)),
    retryCount: 0,
  });
  const balance = () =>
    client.readContract({
      abi: erc20Abi,
      address: token,
      functionName: "balanceOf",
      args: [wallet],
    });
  const observed = (initial: bigint, current: bigint) => {
    const received = current > initial ? current - initial : 0n;
    return {
      balance: formatUnits(current, 6),
      raw_balance: current.toString(),
      received: formatUnits(received, 6),
      raw_received: received.toString(),
    };
  };
  // Without an amount any increase counts; `received` lets callers judge an unrelated deposit.
  const arrived = (initial: bigint, current: bigint) => current >= initial + (requested ?? 1n);
  const success = (initial: bigint, current: bigint) => ({
    status: "success" as const,
    ...base,
    ...observed(initial, current),
  });
  const unfinished = (
    status: "pending" | "timeout",
    initial: bigint,
    current: bigint,
    instruction: string,
  ) => ({
    status,
    ...base,
    ...observed(initial, current),
    ...nextStep(
      instruction,
      [
        "wallet",
        "fund",
        ...(action === "fund" ? [] : [`--${action}`]),
        "--address",
        wallet,
        ...(options.amount === undefined ? [] : ["--amount", options.amount]),
        "--baseline",
        initial.toString(),
        "--no-wait",
      ],
      { network, until: '.status == "success"', pollIntervalSeconds: statusPollSeconds },
    ),
  });
  const pendingInstruction =
    "Finish funding at the url, then run the next command until it reports success.";

  if (options.noWait) {
    // The link works without RPC access; only the status check needs a starting balance.
    const initial = baseline ?? (await balance().catch(() => undefined));
    if (baseline === undefined && !options.noBrowser) openExternal(url);
    if (initial === undefined)
      return {
        status: "pending" as const,
        ...base,
        ...unobserved,
        instruction:
          "Open the url to fund the wallet. The starting balance could not be read, so the CLI cannot report when the funds arrive.",
      };
    const current = baseline === undefined ? initial : await balance();
    return arrived(initial, current)
      ? success(initial, current)
      : unfinished("pending", initial, current, pendingInstruction);
  }

  // Show the link before any RPC call so a balance failure cannot hide it.
  console.error(`Open this link on your device: ${url}`);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Funding wait cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  let initial = baseline;
  let current: bigint | undefined;
  try {
    initial ??= await bounded(balance(), signal);
    // Open the link only after reading the baseline so a fast deposit is not counted in it.
    if (baseline === undefined && !options.noBrowser) openExternal(url);
    console.error(`Waiting for ${action === "mach" ? "MACH" : "funding"}...`);
    for (;;) {
      await sleep(pollMs, undefined, { signal });
      current = await bounded(balance(), signal);
      if (arrived(initial, current)) return success(initial, current);
    }
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason?.name === "TimeoutError" && initial !== undefined)
        return unfinished(
          "timeout",
          initial,
          current ?? initial,
          `Timed out waiting for funding. ${pendingInstruction}`,
        );
      // A rerun waits for a new deposit from a fresh baseline, so neither case is retryable.
      throw walletError({
        code: "E_POLL_TIMEOUT",
        retryable: false,
        message:
          signal.reason?.name === "TimeoutError"
            ? `Timed out waiting for funding. Continue at ${url}`
            : `Funding wait cancelled. Continue at ${url}`,
      });
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

function rawBalance(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw usageError("--baseline must be a raw token balance: a non-negative integer");
  return BigInt(value);
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
    throw usageError("--mach cannot be combined with --crypto or --claim");
  if (options.mach) return "mach";
  if (options.crypto) return "crypto";
  if (options.referralCode) return "claim";
  return "fund";
}

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
