import { Errors } from "incur";

import {
  accessKeyMatches,
  localAccessKeyStatus,
  selectPaymentCapableAccessKey,
} from "../wallet/access-key.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import { errorCodes } from "./errors.js";
import { resolveNetwork, type Network } from "./network.js";
import { continuationCommand } from "./next.js";

/** The logged-in wallet a command acts for, read from one wallet store snapshot. */
export type Wallet = {
  state: WalletState;
  network: Network;
  account: WalletState["accounts"][number];
  /** The payment-capable access key; set whenever `withWallet` required one. */
  key: WalletState["accessKeys"][number] | undefined;
};

type WalletProblemCode = "E_AUTH_REFRESH_REQUIRED" | "E_KEY_EXPIRED" | "E_NOT_AUTHENTICATED";

/** A login or key problem, shaped for incur's `c.error`. */
type WalletProblem = ReturnType<typeof walletProblem>;

type RunContext = {
  agent: boolean;
  globals: { network?: string | undefined };
  error: (error: WalletProblem) => never;
};

/**
 * When the handler needs a payment-capable access key:
 * - `always`: on every run.
 * - `agent`: on agent runs (MCP, `--format`, or stdout not a terminal). An interactive run
 *   without one proceeds, and the wallet app approves its transactions.
 * - `never`: the handler signs through the wallet app, so only the account is required.
 */
type KeyRequirement = "always" | "agent" | "never";

/**
 * Wraps a command's `run` so the handler starts only with a logged-in wallet on the resolved
 * network and, per `requireKey` (default `always`), a payment-capable access key; otherwise
 * the command returns E_NOT_AUTHENTICATED, E_KEY_EXPIRED, or E_AUTH_REFRESH_REQUIRED with the
 * login or refresh command for that network as its `cta`. It wraps `run` because incur
 * middleware cannot see command options, and returns `c.error` because incur drops the `cta`
 * of thrown errors.
 */
export function withWallet<context extends RunContext, result>(
  handler: (context: context, wallet: Wallet) => result | Promise<result>,
  { requireKey = "always" }: { requireKey?: KeyRequirement } = {},
) {
  return async (context: context): Promise<result> => {
    const wallet = await loadWallet(
      context.globals.network,
      requireKey === "always" || (requireKey === "agent" && context.agent),
    );
    return "code" in wallet ? context.error(wallet) : handler(context, wallet);
  };
}

/** Reads the wallet store once, resolves the network, and checks it as `withWallet` does. */
export async function loadWallet(
  networkFlag: string | undefined,
  requireKey = true,
): Promise<Wallet | WalletProblem> {
  const state = await loadWalletState();
  const network = await resolveNetwork(networkFlag, state);
  const account = state.accounts[state.activeAccount ?? 0];
  if (!account) return walletProblem("E_NOT_AUTHENTICATED", network);

  const match = { chainId: network.chainId, walletAddress: account.address };
  const key = selectPaymentCapableAccessKey(state.accessKeys, match);
  if (key || !requireKey) return { state, network, account, key };

  const stale = state.accessKeys.find((candidate) => accessKeyMatches(candidate, match));
  return walletProblem(
    stale && localAccessKeyStatus(stale) === "expired"
      ? "E_KEY_EXPIRED"
      : "E_AUTH_REFRESH_REQUIRED",
    network,
  );
}

/**
 * A login or key problem found below a command's `run`, such as when `tempo request` meets a
 * 402. incur drops the `cta` of thrown errors, so `run` catches this and returns
 * `c.error(error.problem)`.
 */
export class WalletRequiredError extends Errors.IncurError {
  readonly problem: WalletProblem;

  constructor(problem: WalletProblem) {
    super(problem);
    this.problem = problem;
  }
}

/** The login or key problem `code` on `network`, with the command that fixes it as its `cta`. */
export function walletProblem(code: WalletProblemCode, network: Network) {
  const { reason, argv } = walletFix(code, network);
  const command = continuationCommand(argv, network);
  return {
    code,
    message: `${reason} Run '${command}' before retrying.`,
    exitCode: errorCodes[code].exitCode,
    retryable: errorCodes[code].retryable,
    cta: { commands: [{ command }] },
  };
}

/**
 * What `code` means on `network`, and the argv after `tempo` that fixes it: `wallet login` when
 * no wallet is logged in, otherwise `wallet refresh`.
 */
export function walletFix(code: WalletProblemCode, network: Network) {
  const reason = {
    E_AUTH_REFRESH_REQUIRED: `No usable access key is configured for this wallet on ${network.name}.`,
    E_KEY_EXPIRED: `The access key for this wallet on ${network.name} has expired.`,
    E_NOT_AUTHENTICATED: "No wallet is logged in.",
  }[code];
  return { reason, argv: ["wallet", code === "E_NOT_AUTHENTICATED" ? "login" : "refresh"] };
}
