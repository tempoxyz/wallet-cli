import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fundAction, fundUrl, runFundingFlow } from "../src/commands/fund.js";
import { fetchServices, fetchServiceList } from "../src/commands/services.js";
import { expectUsageError, useTempHome } from "./helpers.js";

type ServiceSummary = Awaited<ReturnType<typeof fetchServiceList>>[number];

describe("fundAction", () => {
  it('returns "fund" by default', () => {
    expect(fundAction({})).toBe("fund");
  });

  it("rejects credit funding and points to MACH", () => {
    expect(() => fundAction({ credits: true })).toThrow("tempo wallet fund --mach");
  });

  it('returns "crypto" when crypto is set', () => {
    expect(fundAction({ crypto: true })).toBe("crypto");
  });

  it('returns "claim" when a referral code is provided', () => {
    expect(fundAction({ referralCode: "ABC" })).toBe("claim");
  });

  it("rejects credits even when another funding flag is provided", () => {
    expect(() => fundAction({ credits: true, crypto: true, referralCode: "ABC" })).toThrow(
      "can no longer be purchased",
    );
  });

  it("prioritizes crypto over referral code", () => {
    expect(fundAction({ crypto: true, referralCode: "ABC" })).toBe("crypto");
  });
});

describe("fundUrl", () => {
  it("routes every funding handoff to the /agent page", () => {
    expect(fundUrl("fund")).toBe("https://wallet.tempo.xyz/agent?action=fund");
    expect(fundUrl("crypto")).toBe("https://wallet.tempo.xyz/agent?action=crypto");
    expect(fundUrl("mach")).toBe("https://wallet.tempo.xyz/agent?action=fund&intent=mach");
    expect(fundUrl("claim", { code: "ABC123" })).toBe(
      "https://wallet.tempo.xyz/agent?claim=ABC123",
    );
  });
});

describe("runFundingFlow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TEMPO_WALLET_FUND_POLL_MS;
    delete process.env.TEMPO_WALLET_FUND_TIMEOUT_MS;
  });

  it("throws E_USAGE for crypto funding when no wallet is configured", async () => {
    await useTempHome();

    const error = await runFundingFlow({ action: "crypto", noBrowser: true }).catch((e) => e);
    expectUsageError(
      error,
      "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
    );
  });

  it("throws E_USAGE for default funding when no wallet is configured", async () => {
    await useTempHome();

    const error = await runFundingFlow({ action: "fund", noBrowser: true }).catch((e) => e);
    expectUsageError(
      error,
      "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
    );
  });

  it("returns a claim handoff without waiting when no wallet is configured", async () => {
    await useTempHome();
    const result = await runFundingFlow({ action: "claim", code: "REF123", noBrowser: true });
    expect(result.status).toBe("pending");
    expect(result.url).toContain("https://wallet.tempo.xyz/agent?claim=REF123");
  });
});

describe("fetchServices", () => {
  const serviceDirectory = {
    services: [
      {
        id: "weather",
        name: "Weather API",
        url: "https://weather.example.com",
        serviceUrl: "https://weather.mpp.tempo.xyz",
        description: "Forecasts and current conditions",
        categories: ["data", "climate"],
        tags: ["forecast", "meteorology"],
        endpoints: [
          {
            method: "GET",
            path: "/now",
            description: "Current weather",
            payment: { intent: "pay", amount: "100", decimals: 6, unitType: "usdc" },
            docs: "https://weather.example.com/docs",
          },
        ],
        docs: {
          homepage: "https://weather.example.com",
          llmsTxt: "https://weather.example.com/llms.txt",
        },
      },
      {
        id: "translate",
        name: "Translate Service",
        serviceUrl: "https://translate.example.com",
        description: "Language translation",
        categories: ["nlp"],
        tags: ["language"],
        endpointCount: 4,
      },
    ],
  };

  function mockFetchOk(body: unknown) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response);
  }

  it("normalizes the service list", async () => {
    mockFetchOk(serviceDirectory);

    const list = await fetchServiceList();
    expect(list).toHaveLength(2);

    const [weather, translate] = list;
    expect(weather).toMatchObject({
      id: "weather",
      name: "Weather API",
      url: "https://weather.example.com",
      service_url: "https://weather.mpp.tempo.xyz",
      description: "Forecasts and current conditions",
      categories: ["data", "climate"],
      tags: ["forecast", "meteorology"],
      endpoint_count: 1,
    });

    expect(translate).toMatchObject({
      id: "translate",
      name: "Translate Service",
      service_url: "https://translate.example.com",
      categories: ["nlp"],
      tags: ["language"],
      endpoint_count: 4,
    });
    expect(translate).not.toHaveProperty("url");
  });

  it("searches across tags", async () => {
    mockFetchOk(serviceDirectory);
    const results = (await fetchServices({ search: "meteorology" })) as ServiceSummary[];
    expect(results.map((service) => service.id)).toEqual(["weather"]);
  });

  it("searches across categories", async () => {
    mockFetchOk(serviceDirectory);
    const results = (await fetchServices({ search: "nlp" })) as ServiceSummary[];
    expect(results.map((service) => service.id)).toEqual(["translate"]);
  });

  it("searches across description", async () => {
    mockFetchOk(serviceDirectory);
    const results = (await fetchServices({ search: "translation" })) as ServiceSummary[];
    expect(results.map((service) => service.id)).toEqual(["translate"]);
  });

  it("returns the full list when the search is empty", async () => {
    mockFetchOk(serviceDirectory);
    const results = await fetchServices({ search: "   " });
    expect(results).toHaveLength(2);
  });

  it("looks up a service detail by id", async () => {
    mockFetchOk(serviceDirectory);
    const detail = await fetchServices({ serviceId: "weather" });
    expect(detail).toMatchObject({
      id: "weather",
      docs: {
        homepage: "https://weather.example.com",
        llmsTxt: "https://weather.example.com/llms.txt",
        openapi: null,
        apiReference: null,
      },
      endpoints: [
        {
          method: "GET",
          path: "/now",
          description: "Current weather",
          payment: {
            intent: "pay",
            amount: "100",
            decimals: 6,
            unitType: "usdc",
          },
          docs: "https://weather.example.com/docs",
        },
      ],
    });
  });

  it("strips terminal escapes and invisible characters from directory text", async () => {
    mockFetchOk({
      services: [
        {
          id: "weather",
          name: "\u001b[2J\u001b[HTrusted API",
          description: "Safe\u001b]8;;https://evil.example\u0007 link\u001b]8;;\u0007\u202e",
          categories: ["data\u0007"],
          tags: ["\u2066tag\u2069"],
          endpoints: [
            {
              method: "GET",
              path: "/now\u001b[8m",
              description: "Current\u009b31m weather",
              payment: { amount: "100", unitType: "us\u200bdc" },
            },
          ],
        },
      ],
    });

    expect(await fetchServiceList()).toEqual([
      {
        id: "weather",
        name: "Trusted API",
        description: "Safe link",
        categories: ["data"],
        tags: ["tag"],
        endpoint_count: 1,
      },
    ]);
    expect(await fetchServices({ serviceId: "weather" })).toMatchObject({
      endpoints: [
        {
          path: "/now",
          description: "Current weather",
          payment: { amount: "100", unitType: "usdc" },
        },
      ],
    });
  });

  it.each([
    "stable\u0001enrich",
    "stable\u200benrich",
    "stable\u001b[0menrich",
    "",
    " stableenrich",
  ])("skips a directory entry with the non-slug id %j instead of matching it", async (id) => {
    mockFetchOk({
      services: [
        { id, name: "Impostor", serviceUrl: "https://attacker.example" },
        { id: "stableenrich", name: "StableEnrich", serviceUrl: "https://stableenrich.dev" },
      ],
    });

    expect((await fetchServiceList()).map((service) => service.id)).toEqual(["stableenrich"]);
    expect(await fetchServices({ serviceId: "stableenrich" })).toMatchObject({
      service_url: "https://stableenrich.dev",
    });
  });

  it("refuses to choose between directory entries that share an id", async () => {
    mockFetchOk({
      services: [
        { id: "stableenrich", name: "Impostor", serviceUrl: "https://attacker.example" },
        { id: "stableenrich", name: "StableEnrich", serviceUrl: "https://stableenrich.dev" },
      ],
    });

    await expect(fetchServices({ serviceId: "stableenrich" })).rejects.toMatchObject({
      code: "E_USAGE",
      message: "Service directory lists 'stableenrich' more than once",
    });
  });

  it("reads canonical fields when lookalike keys are present", async () => {
    mockFetchOk({
      services: [
        {
          id: "official",
          "i\u200bd": "other",
          name: "Official",
          "na\u200bme": "Impostor",
          serviceUrl: "https://official.example",
        },
      ],
    });

    expect(await fetchServiceList()).toEqual([
      expect.objectContaining({
        id: "official",
        name: "Official",
        service_url: "https://official.example",
      }),
    ]);
  });

  it("ignores deeply nested fields it does not read", async () => {
    let nested: unknown = [];
    for (let depth = 0; depth < 20_000; depth++) nested = [nested];
    mockFetchOk({ services: [{ id: "weather", name: "Weather API", extra: nested }] });

    expect(await fetchServiceList()).toEqual([
      expect.objectContaining({ id: "weather", name: "Weather API" }),
    ]);
  });

  it("throws E_USAGE for an unknown service id", async () => {
    mockFetchOk(serviceDirectory);
    const error = await fetchServices({ serviceId: "missing" }).catch((e) => e);
    expectUsageError(error, "Configuration missing: service 'missing' not found");
  });

  it("requests the public directory URL with a timeout", async () => {
    const fetch = mockFetchOk(serviceDirectory);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await fetchServiceList();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://mpp.dev/api/services");
    expect(new URL(String(url)).search).toBe("");
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(init?.signal).toBe(timeout.mock.results[0]?.value);
  });

  it.each([
    [
      "a non-OK response",
      "E_HTTP",
      "Failed to fetch service directory: HTTP 503",
      async () => ({ ok: false, status: 503 }) as Response,
    ],
    [
      "a network failure",
      "E_NETWORK",
      "Failed to fetch service directory: fetch failed",
      async () => Promise.reject(new TypeError("fetch failed")),
    ],
    [
      "a timeout",
      "E_NETWORK",
      "Failed to fetch service directory: timed out after 10s",
      async () =>
        Promise.reject(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        ),
    ],
    [
      "an unreadable body",
      "E_NETWORK",
      "Failed to fetch service directory: Unexpected end of JSON input",
      async () =>
        ({
          ok: true,
          status: 200,
          json: async (): Promise<unknown> =>
            Promise.reject(new SyntaxError("Unexpected end of JSON input")),
        }) as Response,
    ],
  ])("maps %s to %s", async (_name, code, message, fetch) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    await expect(fetchServiceList()).rejects.toMatchObject({
      code,
      exitCode: 3,
      message,
      retryable: code === "E_NETWORK",
    });
  });
});
