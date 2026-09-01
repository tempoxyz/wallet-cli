import type { Provider as CoreProvider } from "accounts";
import { Actions } from "viem/tempo";

import { usageError } from "../shared/errors.js";
import { chainId, tokenAddress } from "../shared/network.js";
import { openExternal } from "../shared/process.js";
import { formatMicroUnits, sleep } from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { loadWalletState } from "../wallet/store.js";
import { queryCreditBalance } from "./credits.js";

export type FundAction = "fund" | "crypto" | "credits" | "claim";

export async function runFundingFlow(options: {
  action: FundAction;
  address?: string | undefined;
  code?: string | undefined;
  network?: string | undefined;
  noBrowser?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const walletAddress = options.address ?? activeAccount?.address ?? null;
  if (!activeAccount && options.action !== "claim")
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  if (!walletAddress && options.action !== "claim")
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  const initial = await fundingBalance({
    action: options.action,
    chainId: chainId(options.network),
    walletAddress,
  });
  const url = fundUrl(options.action, { code: options.code });

  console.error(`Fund URL: ${url}`);
  console.error(`Open this link on your device: ${url}`);
  if (!options.noBrowser) openExternal(url);

  if (options.action === "credits") {
    console.error("Complete the credits purchase in the wallet app.");
    console.error("After purchasing credits, return here to continue.");
    console.error("Waiting for credits...");
  } else {
    console.error("After funding is complete, return here to continue.");
    console.error("Waiting for funding...");
  }

  const completed = await waitForFunding({
    action: options.action,
    chainId: chainId(options.network),
    initialRawBalance: initial.rawBalance,
    walletAddress,
  });
  console.error("Funding received!");

  return {
    status: "success" as const,
    wallet: walletAddress?.toLowerCase() ?? null,
    action: options.action,
    balance: completed.balance,
    raw_balance: completed.rawBalance.toString(),
  };
}

export function fundAction(options: {
  credits?: boolean | undefined;
  crypto?: boolean | undefined;
  referralCode?: string | undefined;
}): FundAction {
  if (options.credits) return "credits";
  if (options.crypto) return "crypto";
  if (options.referralCode) return "claim";
  return "fund";
}

async function fundingBalance(options: {
  action: FundAction;
  chainId: number;
  walletAddress: string | null;
}) {
  if (options.action === "credits") {
    if (!options.walletAddress) throw new Error("No wallet is logged in");
    const credits = await queryCreditBalance({
      chainId: options.chainId,
      walletAddress: options.walletAddress,
    });
    return {
      balance: credits.balance,
      rawBalance: BigInt(credits.rawBalance),
    };
  }

  if (!options.walletAddress) {
    return {
      balance: "0.000000",
      rawBalance: 0n,
    };
  }

  const provider = createProvider({
    network: options.chainId === 42431 ? "testnet" : undefined,
  }) as CoreProvider.Provider & { getClient: () => unknown };
  const rawBalance = (
    await Actions.token.getBalance(provider.getClient() as never, {
      account: options.walletAddress as `0x${string}`,
      token: tokenAddress(options.chainId),
    })
  ).amount;

  return {
    balance: formatMicroUnits(rawBalance.toString()),
    rawBalance,
  };
}

async function waitForFunding(options: {
  action: FundAction;
  chainId: number;
  initialRawBalance: bigint;
  walletAddress: string | null;
}) {
  const pollMs = Number(process.env.TEMPO_WALLET_FUND_POLL_MS ?? 2_000);
  const timeoutMs = process.env.TEMPO_WALLET_FUND_TIMEOUT_MS
    ? Number(process.env.TEMPO_WALLET_FUND_TIMEOUT_MS)
    : undefined;
  const started = Date.now();

  for (;;) {
    await sleep(pollMs);
    const current = await fundingBalance(options);
    if (current.rawBalance > options.initialRawBalance) return current;
    if (timeoutMs !== undefined && Date.now() - started >= timeoutMs)
      throw new Error("Timed out waiting for funding");
  }
}

export function fundUrl(action: FundAction, options: { code?: string | undefined } = {}) {
  // The CLI is an agent/MPP surface, so all funding handoffs land on the dedicated
  // /agent page rather than the consumer wallet home.
  const url = new URL("https://wallet.tempo.xyz/agent");
  if (action === "claim" && options.code) {
    url.searchParams.set("claim", options.code);
    return url.toString();
  }
  url.searchParams.set("action", action === "credits" ? "fund" : action);
  if (action === "credits") url.searchParams.set("intent", "credits");
  return url.toString();
}
