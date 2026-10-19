import { Cli } from "incur";
import type { Address } from "viem";
import { ousd } from "viem/tokens";

import { nonDestructive, type WalletCommand } from "../cli/command.js";
import { fundOptions, fundOutput } from "../schemas/fund.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { usageError } from "../shared/errors.js";
import { appUrl, networkFields, resolveNetwork, tokenAddress } from "../shared/network.js";
import {
  fundingAmount,
  machFundingAmount,
  machFundingToken,
  requireWalletAddress,
} from "../shared/mach.js";
import { openExternal } from "../shared/process.js";
import { tokenSymbol } from "../shared/tokens.js";
import { loadWalletState } from "../wallet/store.js";

export default {
  command: Cli.create("fund", {
    description: "Open add-funds flows in the wallet app",
    globals: cliGlobals,
    options: fundOptions,
    alias: globalAlias,
    output: fundOutput,
    async run({ globals, options }) {
      return runFundingFlow({
        action: fundAction({
          credits: options.credits,
          mach: options.mach,
          crypto: options.crypto,
          referralCode: options["referral-code"],
        }),
        address: options.address,
        code: options["referral-code"],
        noBrowser: options.browser === false,
        amount: options.amount,
        network: globals.network,
      });
    },
  }),
  annotations: {
    // Opens a wallet-app flow; any payment happens in the wallet app.
    fund: { ...nonDestructive, idempotentHint: false, openWorldHint: true },
  },
  retiredFlags: [
    {
      flag: "--wait",
      mcp: true,
      replacement: () => ({
        message:
          "--wait was removed; 'tempo wallet fund' only opens the funding page. Complete funding in the wallet app and check your balance before spending.",
      }),
    },
    {
      flag: "--timeout",
      takesValue: true,
      mcp: true,
      replacement: () => ({
        message:
          "--timeout was removed; 'tempo wallet fund' only opens the funding page and does not wait for deposits.",
      }),
    },
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

/** Opens or returns the funding URL without reading balances or tracking a checkout. */
export async function runFundingFlow(options: {
  action: FundAction;
  address?: string | undefined;
  amount?: string | undefined;
  code?: string | undefined;
  network?: string | undefined;
  noBrowser?: boolean | undefined;
}) {
  if (options.action === "credits") throw creditsFundingError();
  const action = options.action;
  const state = await loadWalletState();
  const network = await resolveNetwork(options.network, state);
  const chain = network.chainId;
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

  console.error(`Open this link on your device: ${url}`);
  if (!options.noBrowser) openExternal(url);
  const token =
    action === "mach"
      ? machFundingToken(chain)
      : chain === 4217 && action !== "claim"
        ? (ousd.addresses[4217].toLowerCase() as Address)
        : tokenAddress(chain);
  return {
    status: "pending" as const,
    wallet,
    action,
    url,
    ...networkFields(chain),
    token,
    symbol: action === "mach" ? "MACH" : (tokenSymbol(token, chain) ?? null),
    amount: options.amount ?? null,
    balance: null,
    raw_balance: null,
    instruction: "Complete funding in the wallet app. Check your balance before spending.",
  };
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
