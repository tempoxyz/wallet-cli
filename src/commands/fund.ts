import type { Provider as CoreProvider } from "accounts";
import { isAddress } from "viem";
import { Actions } from "viem/tempo";

import { usageError } from "../shared/errors.js";
import { chainId, tokenAddress } from "../shared/network.js";
import { openExternal } from "../shared/process.js";
import { formatMicroUnits, sleep } from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { loadWalletState } from "../wallet/store.js";

const defaultMachineUsdOrigin = "https://machine-usd.porto.workers.dev";

export type FundAction = "fund" | "crypto" | "credits" | "claim";

export type MachineUsdConfig = {
  chainId: number;
  tokenAddress: `0x${string}`;
};

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

  const selectedChainId = chainId(options.network);
  const machineUsdConfig = options.action === "credits" ? await queryMachineUsdConfig() : undefined;
  if (machineUsdConfig && selectedChainId !== machineUsdConfig.chainId)
    throw usageError("machineUSD funding is only available on Tempo mainnet.");

  const initial = await fundingBalance({
    chainId: selectedChainId,
    token: machineUsdConfig?.tokenAddress,
    walletAddress,
  });
  const url = fundUrl(options.action, {
    address: walletAddress ?? undefined,
    code: options.code,
  });

  console.error(`Fund URL: ${url}`);
  console.error(`Open this link on your device: ${url}`);
  if (!options.noBrowser) openExternal(url);

  if (options.action === "credits") {
    console.error("Complete the machineUSD purchase in the wallet app.");
    console.error("After purchasing machineUSD, return here to continue.");
    console.error("Waiting for machineUSD...");
  } else {
    console.error("After funding is complete, return here to continue.");
    console.error("Waiting for funding...");
  }

  const completed = await waitForFunding({
    chainId: selectedChainId,
    initialRawBalance: initial.rawBalance,
    token: machineUsdConfig?.tokenAddress,
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
  chainId: number;
  token?: `0x${string}` | undefined;
  walletAddress: string | null;
}) {
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
      token: options.token ?? tokenAddress(options.chainId),
    })
  ).amount;

  return {
    balance: formatMicroUnits(rawBalance.toString()),
    rawBalance,
  };
}

async function waitForFunding(options: {
  chainId: number;
  initialRawBalance: bigint;
  token?: `0x${string}` | undefined;
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

export function fundUrl(
  action: FundAction,
  options: { address?: string | undefined; code?: string | undefined } = {},
) {
  if (action === "fund" || action === "credits") {
    const url = new URL("https://wallet.tempo.xyz/onramp");
    if (options.address) url.searchParams.set("recipient", options.address);
    if (action === "credits") url.searchParams.set("token", "MACHUSD");
    return url.toString();
  }

  const url = new URL("https://wallet.tempo.xyz/agent");
  if (action === "claim" && options.code) {
    url.searchParams.set("claim", options.code);
    return url.toString();
  }
  url.searchParams.set("action", action);
  return url.toString();
}

/** Reads the deployed token address and chain used to detect a completed machineUSD purchase. */
export async function queryMachineUsdConfig(options: { origin?: string | undefined } = {}) {
  const origin = options.origin || process.env.TEMPO_MACHINE_USD_ORIGIN || defaultMachineUsdOrigin;
  const response = await fetch(new URL("/v1/config", `${origin.replace(/\/$/, "")}/`).toString());
  const body = (await response.json().catch(() => null)) as {
    chain_id?: unknown;
    token_address?: unknown;
  } | null;
  if (!response.ok) throw new Error("Unable to load machineUSD configuration");
  if (
    !body ||
    typeof body.chain_id !== "number" ||
    !Number.isSafeInteger(body.chain_id) ||
    typeof body.token_address !== "string" ||
    !isAddress(body.token_address, { strict: false })
  )
    throw new Error("machineUSD configuration is invalid");

  return {
    chainId: body.chain_id,
    tokenAddress: body.token_address as `0x${string}`,
  } satisfies MachineUsdConfig;
}
