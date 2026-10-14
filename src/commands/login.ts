import { Keystore } from "accounts";
import { TimeoutError } from "accounts/deviceCode";

import { connect, createLoginProvider } from "../provider.js";
import { commandError } from "../shared/errors.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import { explicitNetwork, parseNetwork, resolveNetwork, type Network } from "../shared/network.js";
import { openExternal } from "../shared/process.js";
import { formatUnixTimestamp, getRecord, nowSeconds, sanitizeText } from "../shared/utils.js";
import {
  clearPendingLogin,
  loadPendingLogin,
  loadWalletState,
  parsePendingLogin,
  savePendingLogin,
  type PendingLogin,
} from "../wallet/store.js";
import { cachedLoginOutput } from "./identity.js";

/** RFC 8628 defaults for a `/register` response without `expires_in` or `interval`. */
const defaultExpiresInSeconds = 600;
const defaultIntervalSeconds = 5;

type PollOptions = {
  /** Seconds between `/token` polls; defaults to the interval the wallet advertises. */
  interval?: number | undefined;
  /** Polls that may come back pending before giving up; defaults to the code's lifetime. */
  maxAttempts?: number | undefined;
};

/**
 * Logs in through the wallet app's device-code flow. With `wait`, polls until the wallet
 * approves the code. Without it, returns the code and URL once the code is registered, and
 * `login status` finishes the login, in this process or a later one.
 */
export async function loginHandler(options: {
  network?: string | undefined;
  browser?: boolean | undefined;
  wait: boolean;
}) {
  const state = await loadWalletState();
  const network = await resolveNetwork(options.network, state);
  const cached = await cachedLoginOutput(state, network);
  if (cached) return cached;

  const pending = await startLogin(network);
  const { code, url } = loginPrompt(pending);
  console.error(`Device confirmation code: ${code}`);
  console.error(`Continue at: ${url}`);
  if (options.browser !== false) openExternal(url);
  if (!options.wait) return pendingLoginOutput(pending, network);

  console.error(`Waiting for approval; the code expires at ${expiresAt(pending)}.`);
  return await finishLogin(pending, network, {});
}

/** Resumes the pending login until it is approved, denied, or expired, or out of attempts. */
export async function loginStatusHandler(options: { network?: string | undefined } & PollOptions) {
  const pending = await loadPendingLogin();
  const requested = explicitNetwork(options.network);
  if (!pending || (requested && requested.name !== pending.network)) {
    const network = requested ?? (await resolveNetwork(undefined));
    const command = continuationCommand(["wallet", "login"], network);
    return commandError(
      "E_USAGE",
      `No login is pending on ${network.name}. Run '${command}' to start one.`,
      command,
    );
  }
  return await finishLogin(pending, parseNetwork(pending.network), options);
}

/**
 * Registers a device code for `wallet_connect` and saves what `finishLogin` needs to poll it
 * from any process: the registration, the PKCE verifier, and the access key the wallet is asked
 * to authorize. The SDK reveals the verifier only in its `/token` polls, so the exchange stops at
 * the first poll, before it is sent. A new login replaces any pending one.
 */
async function startLogin(network: Network) {
  const keystore = Keystore.webCryptoP256({ extractable: true });
  const started: {
    accessKey?: Keystore.createKey.ReturnType;
    registration?: unknown;
    registeredAt?: number;
    codeVerifier?: unknown;
  } = {};
  const provider = createLoginProvider({
    network,
    keystore: {
      ...keystore,
      createKey: async () => (started.accessKey = await keystore.createKey()),
    },
    async fetch(input, init) {
      if (isTokenRequest(input)) {
        started.codeVerifier = tokenRequest(init).code_verifier;
        throw new StopExchange();
      }
      const response = await fetch(input, init);
      started.registration = await response
        .clone()
        .json()
        .catch(() => undefined);
      started.registeredAt = nowSeconds();
      return response;
    },
  });
  await connect(provider, network).catch((error: unknown) => {
    if (started.codeVerifier === undefined) throw error;
  });

  const registration = getRecord(started.registration);
  const pending = parsePendingLogin({
    network: network.name,
    registration,
    codeVerifier: started.codeVerifier,
    accessKey: started.accessKey,
    expiresAt:
      (started.registeredAt ?? nowSeconds()) +
      (typeof registration.expires_in === "number"
        ? registration.expires_in
        : defaultExpiresInSeconds),
  });
  await savePendingLogin(pending);
  return pending;
}

/**
 * Polls the pending device code until the wallet approves, denies, or expires it, or until
 * `maxAttempts` polls come back pending. The SDK runs the `wallet_connect` a blocking login
 * runs, but replays the saved registration instead of registering a new code, polls with the
 * saved PKCE verifier, and authorizes the saved access key, so an approval stores the account
 * and key as it always has. The SDK numbers each exchange's request from 1, so the wallet's
 * response to the request `startLogin` registered answers this one.
 */
async function finishLogin(pending: PendingLogin, network: Network, options: PollOptions) {
  const result = await pollLogin(pending, network, options);
  const login = continuationCommand(["wallet", "login"], network);
  const status = continuationCommand(statusArgv(options), network);
  // The code stays pending, so the same `login status` can pick it up again.
  if (result === "exhausted")
    return commandError(
      "E_POLL_TIMEOUT",
      `The login is still waiting for approval. Run '${status}' to keep waiting; the code expires at ${expiresAt(pending)}.`,
      status,
    );
  if (result === "network")
    return commandError(
      "E_NETWORK",
      `Could not reach the wallet to check the login. Run '${status}' to retry.`,
      status,
      { retryable: true },
    );

  await clearPendingLogin();
  if (result === "denied")
    return commandError(
      "E_LOGIN_DENIED",
      `The login request was denied in the wallet app. Run '${login}' to start a new one.`,
      login,
    );
  if (result === "expired")
    return commandError(
      "E_LOGIN_EXPIRED",
      `The login code expired before it was approved. Run '${login}' to start a new one.`,
      login,
    );
  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: network.chainId,
    ...nextStep("Run the next command to confirm the wallet is ready.", ["wallet", "whoami"], {
      network,
    }),
  };
}

/** The connected accounts, or why polling stopped without them. */
async function pollLogin(pending: PendingLogin, network: Network, options: PollOptions) {
  // The SDK gives up after five minutes unless told otherwise; wait as long as the code lives.
  const timeout = pending.expiresAt * 1000 - Date.now();
  if (timeout <= 0) return "expired";

  const keystore = Keystore.webCryptoP256({ extractable: true });
  let attempts = 0;
  let stopped: "denied" | "expired" | "exhausted" | "network" | undefined;
  const provider = createLoginProvider({
    network,
    keystore: { ...keystore, createKey: async () => pending.accessKey },
    pollingInterval: options.interval === undefined ? undefined : options.interval * 1000,
    timeout,
    async fetch(input, init) {
      if (!isTokenRequest(input)) return Response.json(pending.registration);
      const body = { ...tokenRequest(init), code_verifier: pending.codeVerifier };
      const response = await fetch(input, { ...init, body: JSON.stringify(body) }).catch(
        (error: unknown) => {
          stopped = "network";
          throw error;
        },
      );
      attempts++;
      const error =
        response.status === 400
          ? getRecord(
              await response
                .clone()
                .json()
                .catch(() => undefined),
            ).error
          : undefined;
      if (error === "access_denied") stopped = "denied";
      if (error === "expired_token") stopped = "expired";
      if (
        (error === "authorization_pending" || error === "slow_down") &&
        attempts >= (options.maxAttempts ?? Infinity)
      ) {
        stopped = "exhausted";
        throw new StopExchange();
      }
      return response;
    },
  });
  try {
    return await connect(provider, network);
  } catch (error) {
    if (stopped) return stopped;
    // The SDK stopped waiting because the code's lifetime ran out.
    if (error instanceof Error && error.cause instanceof TimeoutError) return "expired";
    throw error;
  }
}

/** Thrown from the SDK's device-code `fetch` to end the exchange; it never reaches the user. */
class StopExchange extends Error {}

function isTokenRequest(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : input).pathname.endsWith("/token");
}

function tokenRequest(init: RequestInit | undefined) {
  return getRecord(JSON.parse(String(init?.body)));
}

function statusArgv(options: PollOptions) {
  return [
    "wallet",
    "login",
    "status",
    ...(options.interval !== undefined ? ["--interval", String(options.interval)] : []),
    ...(options.maxAttempts !== undefined ? ["--max-attempts", String(options.maxAttempts)] : []),
  ];
}

/** The code and URL to show the user; both come from the wallet server. */
function loginPrompt(pending: PendingLogin) {
  const { registration } = pending;
  return {
    code: sanitizeText(registration.user_code).replace(/^(.{4})(.{4})$/, "$1-$2"),
    url: sanitizeText(registration.verification_uri_complete ?? registration.verification_uri),
  };
}

function expiresAt(pending: PendingLogin) {
  return formatUnixTimestamp(pending.expiresAt) ?? "";
}

function pendingLoginOutput(pending: PendingLogin, network: Network) {
  const { code, url } = loginPrompt(pending);
  // Whole seconds, at the wallet's cadence; polling faster earns `slow_down` replies.
  const interval = Math.ceil(pending.registration.interval ?? defaultIntervalSeconds);
  return {
    status: "pending" as const,
    verification_url: url,
    user_code: code,
    expires_at: expiresAt(pending),
    ...nextStep(
      `Have the user open verification_url, check that it shows the code ${code}, and approve. Then run the next command to finish the login.`,
      ["wallet", "login", "status", "--interval", String(interval)],
      { network, until: '.status != "pending"', pollIntervalSeconds: interval },
    ),
  };
}
