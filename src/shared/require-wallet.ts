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
  key: WalletState["accessKeys"][number];
};

/** A login or key problem, shaped for incur's `c.error`. */
type WalletRequiredError = ReturnType<typeof walletRequiredError>;

type RunContext = {
  globals: { network?: string | undefined };
  error: (error: WalletRequiredError) => never;
};

/**
 * Wraps a command's `run` so the handler starts only with a logged-in wallet that has a
 * payment-capable access key on the resolved network; otherwise the command returns
 * E_NOT_AUTHENTICATED, E_KEY_EXPIRED, or E_AUTH_REFRESH_REQUIRED with the login or refresh
 * command for that network as its `cta`. It wraps `run` because incur middleware cannot see
 * command options, and returns `c.error` because incur drops the `cta` of thrown errors.
 */
export function withWallet<context extends RunContext, result>(
  handler: (context: context, wallet: Wallet) => result | Promise<result>,
) {
  return async (context: context): Promise<result> => {
    const wallet = await loadWallet(context.globals.network);
    return "key" in wallet ? handler(context, wallet) : context.error(wallet);
  };
}

/** Reads the wallet store once, resolves the network, and checks it as `withWallet` does. */
export async function loadWallet(
  networkFlag: string | undefined,
): Promise<Wallet | WalletRequiredError> {
  const state = await loadWalletState();
  const network = await resolveNetwork(networkFlag, state);
  const account = state.accounts[state.activeAccount ?? 0];
  if (!account) return walletRequiredError("E_NOT_AUTHENTICATED", network);

  const match = { chainId: network.chainId, walletAddress: account.address };
  const key = selectPaymentCapableAccessKey(state.accessKeys, match);
  if (key) return { state, network, account, key };

  const stale = state.accessKeys.find((candidate) => accessKeyMatches(candidate, match));
  return walletRequiredError(
    stale && localAccessKeyStatus(stale) === "expired"
      ? "E_KEY_EXPIRED"
      : "E_AUTH_REFRESH_REQUIRED",
    network,
  );
}

function walletRequiredError(
  code: "E_AUTH_REFRESH_REQUIRED" | "E_KEY_EXPIRED" | "E_NOT_AUTHENTICATED",
  network: Network,
) {
  const command = continuationCommand(
    ["wallet", code === "E_NOT_AUTHENTICATED" ? "login" : "refresh"],
    network,
  );
  const problem = {
    E_AUTH_REFRESH_REQUIRED: `No usable access key is configured for this wallet on ${network.name}.`,
    E_KEY_EXPIRED: `The access key for this wallet on ${network.name} has expired.`,
    E_NOT_AUTHENTICATED: "No wallet is logged in.",
  }[code];
  return {
    code,
    message: `${problem} Run '${command}' before retrying.`,
    exitCode: errorCodes[code].exitCode,
    retryable: errorCodes[code].retryable,
    cta: { commands: [{ command }] },
  };
}
