import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import type { Hex } from "viem";

import { defaultStocksUrl, version } from "../../shared/constants.js";
import { httpError, networkError, usageError, walletError } from "../../shared/errors.js";
import type { Network } from "../../shared/network.js";
import { openExternal } from "../../shared/process.js";
import type { Wallet } from "../../shared/require-wallet.js";
import { getArray, getRecord, sanitizeText, stringValue } from "../../shared/utils.js";
import { storedAccessKeyIdentity } from "../../request/identity.js";
import { ensurePrivateWalletDirectory, writePrivateFile } from "../../wallet/store.js";

const requestTimeout = 15_000;
/** A cached token this close to its expiry is replaced before use. */
const expiryMarginMs = 60_000;

/** The Tempo Stocks API: `TEMPO_STOCKS_URL`, else the dev deployment of tempo-stocks. */
export function stocksUrl() {
  const value = process.env.TEMPO_STOCKS_URL || defaultStocksUrl;
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol))
    throw usageError("TEMPO_STOCKS_URL must be an http(s) URL");
  return new URL(value).origin;
}

export type StocksDependencies = {
  fetch: typeof globalThis.fetch;
  /** Signs the Tempo Stocks sign-in message as the wallet, with its access key. */
  signMessage: (wallet: Wallet, message: string) => Promise<Hex>;
  open: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const defaultStocksDependencies: StocksDependencies = {
  fetch: (input, init) => globalThis.fetch(input, init),
  signMessage: signWithAccessKey,
  open: openExternal,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Signs `message` with the wallet's stored access key, as the wallet account: the signature is a
 * keychain envelope that Tempo Stocks verifies against the AccountKeychain.
 */
async function signWithAccessKey(wallet: Wallet, message: string) {
  const identity = await storedAccessKeyIdentity(wallet.state, { network: wallet.network.name });
  if (!identity)
    throw usageError(
      "No usable access key can sign in to Tempo Stocks. Run 'tempo wallet refresh', then retry.",
    );
  return await identity.account.signMessage({ message });
}

type Session = { token: string; expiresAt: number };

/** A signed-in Tempo Stocks client for one wallet on one network. */
export type StocksClient = {
  origin: string;
  network: Network;
  address: string;
  /** The service's trading fee in basis points, from its config. */
  feeBps: number;
  dependencies: StocksDependencies;
  get: (path: string) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
};

/**
 * Connects to Tempo Stocks for `wallet`: checks the service runs on the wallet's network, then
 * signs in with the access key, reusing a cached token until it expires.
 */
export async function connectStocks(
  wallet: Wallet,
  dependencies: Partial<StocksDependencies> = {},
): Promise<StocksClient> {
  const runtime = { ...defaultStocksDependencies, ...dependencies };
  const origin = stocksUrl();
  const { network } = wallet;
  const address = wallet.account.address.toLowerCase();
  const config = getRecord(await call(runtime, origin, "GET", "/api/config"));
  const served = stringValue(config.network);
  if (served !== network.name) {
    const other = served === "mainnet" || served === "testnet" ? served : undefined;
    throw usageError(
      `Tempo Stocks at ${origin} runs on ${served || "an unknown network"}, not ${network.name}.${other ? ` Pass --network ${other}.` : ""}`,
    );
  }
  const feeBps = typeof config.feeBps === "number" ? config.feeBps : 0;
  const key = `${origin} ${network.name} ${address}`;

  let session = await cachedSession(key, runtime.now());
  const signIn = async () => {
    const nonce = getRecord(
      await call(runtime, origin, "POST", "/api/auth/nonce", { body: { address } }),
    );
    const message = stringValue(nonce.message);
    if (!message) throw networkError("Tempo Stocks returned no sign-in message");
    const signature = await runtime.signMessage(wallet, message);
    const verified = getRecord(
      await call(runtime, origin, "POST", "/api/auth/verify", { body: { message, signature } }),
    );
    const token = stringValue(verified.token);
    const expiresAt = parseExpiry(verified.expiresAt);
    if (!token || expiresAt === undefined)
      throw networkError("Tempo Stocks sign-in returned no session token");
    session = { token, expiresAt };
    await saveSession(key, session, runtime.now());
    return session;
  };

  const authed = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const current = session ?? (await signIn());
    try {
      return await call(runtime, origin, method, path, { body, token: current.token });
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      const renewed = await signIn();
      return await call(runtime, origin, method, path, { body, token: renewed.token });
    }
  };

  return {
    origin,
    network,
    address,
    feeBps,
    dependencies: runtime,
    get: (path) => authed("GET", path),
    post: (path, body) => authed("POST", path, body),
  };
}

class UnauthorizedError extends Error {}

async function call(
  runtime: StocksDependencies,
  origin: string,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; token?: string | undefined } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `wallet-cli/${version}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await runtime.fetch(new URL(path, origin), {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `timed out after ${requestTimeout / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error);
    // Only reads are safe to repeat; a POST may have reached the server.
    throw networkError(`Tempo Stocks request failed: ${reason}`, { retryable: method === "GET" });
  }
  if (response.status === 401 && options.token) throw new UnauthorizedError();
  if (response.status === 204) return undefined;
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = getRecord(getRecord(body).error);
    const code = sanitizeText(stringValue(error.code));
    const message = sanitizeText(stringValue(error.message)) || `HTTP ${response.status}`;
    throw httpError(response.status, `Tempo Stocks: ${message}${code ? ` (${code})` : ""}`);
  }
  return body;
}

/** `expiresAt` as epoch milliseconds, from an ISO date or epoch seconds or milliseconds. */
export function parseExpiry(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Where Tempo Stocks session tokens are cached, by API origin, network, and wallet. */
export function stocksSessionsPath() {
  return join(homedir(), ".tempo", "wallet", "stocks-sessions.json");
}

async function readSessions(): Promise<Record<string, Session>> {
  try {
    const sessions = getRecord(
      getRecord(JSON.parse(await readFile(stocksSessionsPath(), "utf8"))).sessions,
    );
    return Object.fromEntries(
      Object.entries(sessions).flatMap(([key, value]) => {
        const item = getRecord(value);
        const token = stringValue(item.token);
        return token && typeof item.expiresAt === "number"
          ? [[key, { token, expiresAt: item.expiresAt }]]
          : [];
      }),
    );
  } catch {
    // A missing or corrupt cache only costs a sign-in.
    return {};
  }
}

async function cachedSession(key: string, now: number) {
  const session = (await readSessions())[key];
  return session && session.expiresAt - expiryMarginMs > now ? session : undefined;
}

async function saveSession(key: string, session: Session, now: number) {
  const sessions = Object.fromEntries(
    Object.entries(await readSessions()).filter(([, value]) => value.expiresAt > now),
  );
  sessions[key] = session;
  const path = stocksSessionsPath();
  try {
    await ensurePrivateWalletDirectory(path);
    await writePrivateFile(path, JSON.stringify({ sessions }, null, 2));
  } catch {
    // The cache only saves a sign-in, so failing to write it must not fail the command.
  }
}

/** The onboarding stage of the signed-in account, as `GET /api/me` reports it. */
export async function onboardingStage(client: StocksClient) {
  const onboarding = getRecord(getRecord(await client.get("/api/me")).onboarding);
  return {
    stage: sanitizeText(stringValue(onboarding.stage)),
    reason: sanitizeText(stringValue(onboarding.reason)) || undefined,
  };
}

/**
 * Refuses with `E_ONBOARDING_REQUIRED` unless the account has finished Tempo Stocks onboarding, after
 * opening the onboarding page in the browser (or only printing it with `noBrowser`).
 */
export async function requireOnboarded(client: StocksClient, noBrowser: boolean | undefined) {
  const { stage, reason } = await onboardingStage(client);
  if (stage === "ready") return;
  const url = client.origin;
  if (stage === "blocked")
    throw walletError({
      code: "E_ONBOARDING_REQUIRED",
      message: `Tempo Stocks cannot trade for this account${reason ? `: ${reason}` : ""}. See ${url}.`,
    });
  console.error(`Open this link on your device: ${url}`);
  if (!noBrowser) client.dependencies.open(url);
  throw walletError({
    code: "E_ONBOARDING_REQUIRED",
    message: `Tempo Stocks onboarding is not finished (stage: ${stage || "unknown"}). Finish it in the browser at ${url}, then retry.`,
  });
}

export type Stock = {
  id: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  is_fractionable: boolean;
  is_tradable: boolean;
};

export function stockItem(value: unknown): Stock {
  const item = getRecord(value);
  const logo = sanitizeText(stringValue(item.logoUrl));
  return {
    id: sanitizeText(stringValue(item.id)),
    symbol: sanitizeText(stringValue(item.symbol)),
    name: sanitizeText(stringValue(item.name)),
    logo_url: logo || null,
    is_fractionable: item.isFractionable === true,
    is_tradable: item.isTradable === true,
  };
}

/** Lists stocks, or only those with `symbols` when any are given. */
export async function listStocks(client: StocksClient, symbols: readonly string[] = []) {
  const query =
    symbols.length > 0
      ? `?symbols=${encodeURIComponent(symbols.map((symbol) => symbol.toUpperCase()).join(","))}`
      : "";
  const body = getRecord(await client.get(`/api/market/stocks${query}`));
  return getArray(body.stocks).map(stockItem);
}

/** The stock with `symbol`, matched without regard to case; `E_NOT_FOUND` when none has it. */
export async function resolveStock(
  client: StocksClient,
  symbol: string,
  options: { tradable?: boolean } = {},
) {
  const wanted = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,16}$/.test(wanted))
    throw usageError(`Invalid stock symbol: ${JSON.stringify(sanitizeText(symbol))}`);
  const stock = (await listStocks(client, [wanted])).find(
    (candidate) => candidate.symbol.toUpperCase() === wanted,
  );
  if (!stock || !stock.id)
    throw walletError({
      code: "E_NOT_FOUND",
      message: `Tempo Stocks has no stock with symbol ${wanted}. List stocks with 'tempo wallet stocks list'.`,
    });
  if (options.tradable && !stock.is_tradable)
    throw usageError(`${stock.symbol} is not tradable on Tempo Stocks right now`);
  return stock;
}

/** A decimal from the API as text, or `null` when it has none. */
export function decimalText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}
