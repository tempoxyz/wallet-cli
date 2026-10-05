import { setTimeout as sleep } from "node:timers/promises";
import { erc20Abi, formatUnits } from "viem";

import { usageError } from "../shared/errors.js";
import { chainId, createTempoPublicClient, tokenAddress } from "../shared/network.js";
import {
  fundingAmount,
  machFundingAmount,
  machFundingToken,
  requireWalletAddress,
  warnCreditsAlias,
} from "../shared/mach.js";
import { openExternal } from "../shared/process.js";
import { loadWalletState } from "../wallet/store.js";

export type FundAction = "fund" | "mach" | "crypto" | "credits" | "claim";

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
  if (options.action === "credits") warnCreditsAlias();
  const action =
    options.action === "credits" || options.action === "fund" ? "mach" : options.action;
  const chain = chainId(options.network);
  const token = action === "mach" ? machFundingToken(chain) : tokenAddress(chain);
  const requested =
    action === "mach" ? machFundingAmount(options.amount) : fundingAmount(options.amount);
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
  const state = await loadWalletState();
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
    chain_id: chain,
    token,
    symbol: action === "mach" ? "MACH" : undefined,
    amount: options.amount ?? null,
  };
  // A handoff works without RPC access or a locally installed browser.
  if (options.noWait || !wallet) {
    if (!options.noBrowser) openExternal(url);
    return { status: "pending" as const, ...base, balance: null, raw_balance: null };
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Funding wait cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    const client = createTempoPublicClient(options.network, {
      timeout: Math.min(10_000, Math.max(1, timeoutMs)),
      retryCount: 0,
    });
    const balance = () =>
      bounded(
        client.readContract({
          abi: erc20Abi,
          address: token,
          functionName: "balanceOf",
          args: [wallet],
        }),
        signal,
      );
    const initial = await balance();
    console.error(`Open this link on your device: ${url}`);
    if (!options.noBrowser) openExternal(url);
    console.error(`Waiting for ${action === "mach" ? "MACH" : "funding"}...`);
    for (;;) {
      await sleep(pollMs, undefined, { signal });
      const current = await balance();
      // Never treat a smaller, unrelated deposit as the full requested amount.
      if (current >= initial + (requested ?? 1n)) {
        return {
          status: "success" as const,
          ...base,
          balance: formatUnits(current, 6),
          raw_balance: current.toString(),
        };
      }
    }
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason?.name === "TimeoutError")
        throw new Error(`Timed out waiting for funding. Continue at ${url}`);
      throw new Error(`Funding wait cancelled. Continue at ${url}`);
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
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
  if ((options.mach || options.credits) && (options.crypto || options.referralCode))
    throw usageError("--mach/--credits cannot be combined with --crypto or --claim");
  if (options.credits) warnCreditsAlias();
  if (options.mach || options.credits) return "mach";
  if (options.crypto) return "crypto";
  if (options.referralCode) return "claim";
  return "mach";
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
  const url = new URL("https://wallet.tempo.xyz/agent");
  if (action === "claim" && options.code) url.searchParams.set("claim", options.code);
  else {
    const mach = action === "mach" || action === "credits" || action === "fund";
    url.searchParams.set("action", mach ? "fund" : action);
    if (mach) {
      machFundingToken(options.chainId ?? 4217);
      url.searchParams.set("intent", "mach");
    }
  }
  if (options.address) url.searchParams.set("address", requireWalletAddress(options.address));
  if (options.chainId !== undefined) url.searchParams.set("chainId", String(options.chainId));
  if (options.amount !== undefined) {
    if (action === "mach" || action === "credits" || action === "fund")
      machFundingAmount(options.amount);
    else fundingAmount(options.amount);
    url.searchParams.set("amount", options.amount);
  }
  return url.toString();
}
