import { readFile, stat } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectStocks, resolveStock, stocksSessionsPath } from "../src/commands/stocks/api.js";
import { listHandler } from "../src/commands/stocks/list.js";
import { placeOrder, type TradeInput } from "../src/commands/stocks/trade.js";
import type { Wallet } from "../src/shared/require-wallet.js";
import { testWallet, useTempHome, walletState } from "./helpers.js";

const origin = "http://stocks.test";
const aapl = {
  id: "stock-aapl",
  symbol: "AAPL",
  name: "Apple Inc.",
  logoUrl: null,
  isFractionable: true,
  isTradable: true,
};
const halted = { ...aapl, id: "stock-halt", symbol: "HALT", name: "Halted", isTradable: false };

type Route = (request: { body: unknown; headers: Headers; url: URL }) => Response | undefined;

/** A Tempo Stocks API on mainnet that records each call as `METHOD /path?query`. */
function stocksApi(overrides: Record<string, Route> = {}) {
  const calls: { route: string; authorization: string | null; body: unknown }[] = [];
  let tokens = 0;
  const routes: Record<string, Route> = {
    "GET /api/config": () =>
      Response.json({ network: "mainnet", feeBps: 50, configured: { dinari: true } }),
    "POST /api/auth/nonce": ({ body }) =>
      Response.json({ message: `sign in ${(body as { address: string }).address}` }),
    "POST /api/auth/verify": () =>
      Response.json({
        address: testWallet.toLowerCase(),
        session: "accessKey",
        token: `token-${++tokens}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    "GET /api/me": () =>
      Response.json({ address: testWallet, session: "accessKey", onboarding: { stage: "ready" } }),
    "GET /api/market/stocks": ({ url }) => {
      const wanted = (url.searchParams.get("symbols") ?? "").split(",");
      return Response.json({
        stocks: [aapl, halted].filter((stock) => wanted.includes(stock.symbol)),
        next: null,
      });
    },
    "GET /api/market/stocks/stock-aapl/quote": () =>
      Response.json({ stockId: "stock-aapl", bid: 199.5, ask: 200, price: 199.75 }),
    "GET /api/market/hours": () => Response.json({ isOpen: true, nextOpen: null, nextClose: null }),
    "POST /api/orders/permit": () =>
      Response.json({
        orderRequestId: "req-1",
        fee: "0.5",
        typedData: {},
        approvalUrl: `${origin}/approve/req-1`,
      }),
    ...overrides,
  };
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({
      route: `${route}${url.search}`,
      authorization: headers.get("authorization"),
      body,
    });
    const response = routes[route]?.({ body, headers, url });
    return (
      response ?? Response.json({ error: { code: "not_found", message: route } }, { status: 404 })
    );
  });
  return { calls, fetch, routes: () => calls.map((call) => call.route) };
}

function wallet(): Wallet {
  const state = walletState();
  return {
    state,
    network: { name: "mainnet", chainId: 4217 },
    account: state.accounts[0]!,
    key: state.accessKeys[0],
  };
}

const signMessage = vi.fn(async () => "0xsigned" as const);
const open = vi.fn();
const sleep = vi.fn(async () => undefined);

function dependencies(api: ReturnType<typeof stocksApi>) {
  return { fetch: api.fetch as typeof globalThis.fetch, signMessage, open, sleep };
}

beforeEach(async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_STOCKS_URL", origin);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signMessage.mockClear();
  open.mockClear();
  sleep.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("stock symbols", () => {
  it("resolves a symbol without regard to case", async () => {
    const api = stocksApi();
    const client = await connectStocks(wallet(), dependencies(api));

    await expect(resolveStock(client, "aapl")).resolves.toMatchObject({
      id: "stock-aapl",
      symbol: "AAPL",
      is_tradable: true,
    });
    expect(api.routes()).toContain("GET /api/market/stocks?symbols=AAPL");
  });

  it("fails with E_NOT_FOUND for an unknown symbol", async () => {
    const client = await connectStocks(wallet(), dependencies(stocksApi()));

    await expect(resolveStock(client, "MSFT")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  it("refuses to trade a stock that is not tradable", async () => {
    const api = stocksApi();
    await expect(
      placeOrder(
        wallet(),
        trade({ symbol: "halt", options: { "dry-run": true } }),
        dependencies(api),
      ),
    ).rejects.toMatchObject({
      code: "E_USAGE",
      message: "HALT is not tradable on Tempo Stocks right now",
    });
  });

  it("refuses a service on another network than the wallet's", async () => {
    const api = stocksApi({ "GET /api/config": () => Response.json({ network: "testnet" }) });

    await expect(listHandler(wallet(), [], dependencies(api))).rejects.toMatchObject({
      code: "E_USAGE",
      message: `Tempo Stocks at ${origin} runs on testnet, not mainnet. Pass --network testnet.`,
    });
    expect(signMessage).not.toHaveBeenCalled();
  });
});

describe("stocks sign-in", () => {
  it("signs in once and reuses the cached token until it expires", async () => {
    const api = stocksApi();
    await listHandler(wallet(), ["AAPL"], dependencies(api));
    await listHandler(wallet(), ["AAPL"], dependencies(api));

    expect(signMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ account: { address: testWallet } }),
      `sign in ${testWallet.toLowerCase()}`,
    );
    expect(api.routes().filter((route) => route === "POST /api/auth/verify")).toHaveLength(1);
    expect(
      api.calls
        .filter((call) => call.route.startsWith("GET /api/market"))
        .map((call) => call.authorization),
    ).toEqual(["Bearer token-1", "Bearer token-1"]);
    const cache = JSON.parse(await readFile(stocksSessionsPath(), "utf8")) as {
      sessions: Record<string, { token: string }>;
    };
    expect(cache.sessions[`${origin} mainnet ${testWallet.toLowerCase()}`]?.token).toBe("token-1");
    expect((await stat(stocksSessionsPath())).mode & 0o777).toBe(0o600);
  });

  it("signs in again once the cached token has expired", async () => {
    const api = stocksApi();
    await listHandler(wallet(), [], dependencies(api));
    await listHandler(wallet(), [], { ...dependencies(api), now: () => Date.now() + 7_200_000 });

    expect(signMessage).toHaveBeenCalledTimes(2);
    expect(api.calls.at(-1)?.authorization).toBe("Bearer token-2");
  });

  it("signs in again and retries once when the server refuses the token", async () => {
    let refused = false;
    const api = stocksApi({
      "GET /api/market/stocks": ({ headers }) => {
        if (headers.get("authorization") === "Bearer token-1") {
          refused = true;
          return Response.json(
            { error: { code: "unauthorized", message: "expired" } },
            { status: 401 },
          );
        }
        return Response.json({ stocks: [aapl], next: null });
      },
    });
    const result = await listHandler(wallet(), ["AAPL"], dependencies(api));

    expect(refused).toBe(true);
    expect(result.stocks.map((stock) => stock.symbol)).toEqual(["AAPL"]);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });
});

function trade(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    side: "BUY",
    amount: "100",
    symbol: "AAPL",
    options: { yes: true, browser: true, wait: true },
    interactive: false,
    ...overrides,
  };
}

/** Answers order request polls with each status in turn, repeating the last. */
function requestStatuses(...statuses: { status: string; orderId?: string; message?: string }[]) {
  let index = 0;
  return () => Response.json({ id: "req-1", ...statuses[Math.min(index++, statuses.length - 1)] });
}

describe("stocks buy", () => {
  it("estimates a market buy in USD without creating an order", async () => {
    const api = stocksApi();
    const result = await placeOrder(
      wallet(),
      trade({ options: { "dry-run": true, browser: true, wait: true } }),
      dependencies(api),
    );

    expect(result).toMatchObject({
      status: "dry_run",
      side: "BUY",
      type: "MARKET",
      amount_unit: "usd",
      price: "200",
      estimated_shares: "0.5",
      estimated_value: "100.00",
      estimated_fee: "0.50",
      fee_bps: 50,
      _next: { command: "tempo wallet stocks buy 100 AAPL --yes --network mainnet" },
    });
    expect(api.routes()).not.toContain("POST /api/orders/permit");
  });

  it("opens the approval link and waits until the order is submitted", async () => {
    const api = stocksApi({
      "GET /api/orders/requests/req-1": requestStatuses(
        { status: "QUOTED" },
        { status: "PENDING" },
        { status: "SUBMITTED", orderId: "order-1" },
      ),
    });
    const result = await placeOrder(wallet(), trade(), dependencies(api));

    expect(result).toMatchObject({
      status: "submitted",
      order_request_id: "req-1",
      order_id: "order-1",
      fee: "0.5",
      _next: { command: "tempo wallet stocks orders --network mainnet" },
    });
    expect(api.calls.find((call) => call.route === "POST /api/orders/permit")?.body).toEqual({
      stockId: "stock-aapl",
      side: "BUY",
      type: "MARKET",
      amount: "100",
    });
    expect(open).toHaveBeenCalledExactlyOnceWith(`${origin}/approve/req-1`);
    expect(api.routes().filter((route) => route === "GET /api/orders/requests/req-1")).toHaveLength(
      3,
    );
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails with E_ORDER_REJECTED when the order request is rejected", async () => {
    const api = stocksApi({
      "GET /api/orders/requests/req-1": requestStatuses(
        { status: "PENDING" },
        { status: "REJECTED", message: "Insufficient buying power" },
      ),
    });

    await expect(placeOrder(wallet(), trade(), dependencies(api))).rejects.toMatchObject({
      code: "E_ORDER_REJECTED",
      message: "Order rejected: Insufficient buying power",
    });
  });

  it("sends a limit buy in shares and returns at once with --no-wait", async () => {
    const api = stocksApi();
    const result = await placeOrder(
      wallet(),
      trade({
        amount: "1.5",
        options: { "limit-price": "150", yes: true, browser: false, wait: false },
      }),
      dependencies(api),
    );

    expect(result).toMatchObject({
      status: "pending_approval",
      type: "LIMIT",
      amount_unit: "shares",
      approval_url: `${origin}/approve/req-1`,
    });
    expect(api.calls.find((call) => call.route === "POST /api/orders/permit")?.body).toMatchObject({
      type: "LIMIT",
      amount: "1.5",
      limitPrice: "150",
    });
    expect(open).not.toHaveBeenCalled();
    expect(api.routes()).not.toContain("GET /api/orders/requests/req-1");
  });

  it("creates nothing for a script without --yes", async () => {
    const api = stocksApi();

    await expect(
      placeOrder(wallet(), trade({ options: { browser: true, wait: true } }), dependencies(api)),
    ).rejects.toMatchObject({ code: "E_USAGE" });
    expect(api.routes()).not.toContain("POST /api/orders/permit");
  });

  it("sends an account that has not finished onboarding to the browser", async () => {
    const api = stocksApi({
      "GET /api/me": () => Response.json({ onboarding: { stage: "identity" } }),
    });

    await expect(placeOrder(wallet(), trade(), dependencies(api))).rejects.toMatchObject({
      code: "E_ONBOARDING_REQUIRED",
    });
    expect(open).toHaveBeenCalledExactlyOnceWith(origin);
    expect(api.routes()).not.toContain("POST /api/orders/permit");
  });

  it.each([
    { amount: "10.001", options: {} },
    { amount: "0", options: {} },
    { amount: "1.00001", options: { "limit-price": "100" } },
  ])("refuses the amount $amount before contacting the service", async ({ amount, options }) => {
    const api = stocksApi();

    await expect(
      placeOrder(
        wallet(),
        trade({ amount, options: { yes: true, ...options } }),
        dependencies(api),
      ),
    ).rejects.toMatchObject({ code: "E_USAGE" });
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
