import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fundAction, fundUrl, runFundingFlow } from "../src/commands/fund.js";
import { appUrl } from "../src/shared/network.js";
import {
  serviceDirectoryCachePath,
  staleListFetchedAt,
} from "../src/commands/services/directory.js";
import { listServices } from "../src/commands/services/list.js";
import { searchServices } from "../src/commands/services/search.js";
import { showService } from "../src/commands/services/show.js";
import { expectUsageError, useTempHome } from "./helpers.js";

/** The wallet app's funding page, on the app `TEMPO_AUTH_URL` names. */
const agent = new URL("/agent", appUrl).toString();

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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    { authUrl: undefined, expected: "https://wallet.tempo.xyz/agent?action=fund" },
    {
      authUrl: "https://wallet-preview.tempo.local",
      expected: "https://wallet-preview.tempo.local/agent?action=fund",
    },
    { authUrl: "http://127.0.0.1:5173/", expected: "http://127.0.0.1:5173/agent?action=fund" },
  ])("uses the CLI's wallet app for TEMPO_AUTH_URL=$authUrl", async ({ authUrl, expected }) => {
    vi.stubEnv("TEMPO_AUTH_URL", authUrl);
    vi.resetModules();
    const fund = await import("../src/commands/fund.js");
    expect(fund.fundUrl("fund")).toBe(expected);
  });

  it("routes every funding handoff to the /agent page", () => {
    expect(fundUrl("fund")).toBe(`${agent}?action=fund`);
    expect(fundUrl("crypto")).toBe(`${agent}?action=crypto`);
    expect(fundUrl("mach")).toBe(`${agent}?action=fund&intent=mach`);
    expect(fundUrl("claim", { code: "ABC123" })).toBe(`${agent}?claim=ABC123`);
  });
});

describe("runFundingFlow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TEMPO_WALLET_FUND_POLL_MS;
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
    expect(result).toMatchObject({
      status: "pending",
      url: `${agent}?claim=REF123&chainId=4217`,
    });
    expect(result).not.toHaveProperty("_next");
  });
});

describe("service directory", () => {
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

  beforeEach(async () => {
    await useTempHome();
  });

  function mockFetchText(text: string) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(text));
  }

  function mockFetchOk(body: unknown) {
    return mockFetchText(JSON.stringify(body));
  }

  it("normalizes the service list", async () => {
    mockFetchOk(serviceDirectory);

    const list = await listServices();
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
    const results = await searchServices({ query: "meteorology" });
    expect(results.map((service) => service.id)).toEqual(["weather"]);
  });

  it("searches across categories", async () => {
    mockFetchOk(serviceDirectory);
    const results = await searchServices({ query: "nlp" });
    expect(results.map((service) => service.id)).toEqual(["translate"]);
  });

  it("searches across description", async () => {
    mockFetchOk(serviceDirectory);
    const results = await searchServices({ query: "translation" });
    expect(results.map((service) => service.id)).toEqual(["translate"]);
  });

  it("returns the full list when the search is empty", async () => {
    mockFetchOk(serviceDirectory);
    const results = await searchServices({ query: "   " });
    expect(results).toHaveLength(2);
  });

  it("looks up a service detail by id", async () => {
    mockFetchOk(serviceDirectory);
    const detail = await showService({ serviceId: "weather" });
    expect(detail).toMatchObject({
      id: "weather",
      docs: {
        homepage: "https://weather.example.com",
        llms_txt: "https://weather.example.com/llms.txt",
        openapi: null,
        api_reference: null,
      },
      endpoints: [
        {
          method: "GET",
          path: "/now",
          description: "Current weather",
          payment: {
            intent: "pay",
            raw_amount: "100",
            decimals: 6,
            price: "0.0001",
            unit_type: "usdc",
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

    expect(await listServices()).toEqual([
      {
        id: "weather",
        name: "Trusted API",
        description: "Safe link",
        categories: ["data"],
        tags: ["tag"],
        endpoint_count: 1,
      },
    ]);
    expect(await showService({ serviceId: "weather" })).toMatchObject({
      endpoints: [
        {
          path: "/now",
          description: "Current weather",
          payment: { raw_amount: "100", unit_type: "usdc" },
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

    expect((await listServices()).map((service) => service.id)).toEqual(["stableenrich"]);
    expect(await showService({ serviceId: "stableenrich" })).toMatchObject({
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

    await expect(showService({ serviceId: "stableenrich" })).rejects.toMatchObject({
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

    expect(await listServices()).toEqual([
      expect.objectContaining({
        id: "official",
        name: "Official",
        service_url: "https://official.example",
      }),
    ]);
  });

  it("ignores deeply nested fields it does not read", async () => {
    const nested = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;
    mockFetchText(`{"services":[{"id":"weather","name":"Weather API","extra":${nested}}]}`);

    expect(await listServices()).toEqual([
      expect.objectContaining({ id: "weather", name: "Weather API" }),
    ]);
    // The cached copy is read back without re-serializing the nesting.
    expect(await listServices()).toEqual([
      expect.objectContaining({ id: "weather", name: "Weather API" }),
    ]);
  });

  describe("search", () => {
    const searchDirectory = {
      services: [
        {
          id: "polyglot",
          name: "Polyglot",
          description: "Translate text between languages",
          tags: ["language"],
        },
        {
          id: "studio",
          name: "Studio",
          description: "Media tools",
          categories: ["media"],
          tags: ["image-generation", "video"],
        },
        {
          id: "translate",
          name: "Translate Service",
          description: "Language translation",
          categories: ["nlp"],
        },
        {
          id: "weather",
          name: "Weather API",
          description: "Forecasts and current conditions",
          tags: ["forecast"],
        },
      ],
    };

    it.each([
      ["image generation", ["studio"]],
      ["Image_Generation", ["studio"]],
      ["image-generation", ["studio"]],
      ["generation  image", ["studio"]],
      ["weather forecast", ["weather"]],
      ["weather language", []],
      ["language", ["polyglot", "translate"]],
      ["translate", ["translate", "polyglot"]],
      ["translate service", ["translate"]],
      ["weather-api", ["weather"]],
      [" - ", ["polyglot", "studio", "translate", "weather"]],
      [Array(200).fill("weather").join(" ").slice(0, 256), ["weather"]],
    ])("matches %j to %j", async (search, ids) => {
      mockFetchOk(searchDirectory);
      const results = await searchServices({ query: search });
      expect(results.map((service) => service.id)).toEqual(ids);
    });

    it.each([
      ["a".repeat(257), "Search queries accept at most 256 characters"],
      [
        Array.from({ length: 17 }, (_, index) => `w${index}`).join(" "),
        "Search queries accept at most 16 distinct words",
      ],
    ])("rejects oversized search %#", async (search, message) => {
      mockFetchOk(searchDirectory);
      await expect(searchServices({ query: search })).rejects.toMatchObject({
        code: "E_USAGE",
        message,
      });
    });

    // The CLI drops a query's leading dashes so it is never read as a flag; see normalizeServicesArgs.
    it.each(["--language", "-language", "--translate service", "--", "-"])(
      "matches %j as it does without its leading dashes",
      async (search) => {
        mockFetchOk(searchDirectory);
        expect(await searchServices({ query: search })).toEqual(
          await searchServices({ query: search.replace(/^-+/, "") }),
        );
      },
    );
  });

  it.each([
    ["100", 6, "0.0001"],
    ["10000", 6, "0.01"],
    ["1500000", 6, "1.5"],
    ["0", 6, "0"],
    ["5", 0, "5"],
    [undefined, 6, null],
    ["100", undefined, null],
    ["1.5", 6, null],
    ["-1", 6, null],
    ["100", -1, null],
    ["100", 1.5, null],
    ["100", 256, null],
    ["9".repeat(78), 0, "9".repeat(78)],
    ["9".repeat(79), 0, null],
  ])("formats amount %j with %j decimals as price %j", async (amount, decimals, price) => {
    mockFetchOk({
      services: [
        { id: "weather", name: "Weather API", endpoints: [{ payment: { amount, decimals } }] },
      ],
    });

    expect(await showService({ serviceId: "weather" })).toMatchObject({
      endpoints: [{ payment: { raw_amount: amount ?? "", decimals: decimals ?? null, price } }],
    });
  });

  it.each([
    ["stablenrich", "service 'stablenrich' not found; did you mean: stableenrich?"],
    [
      "stable",
      "service 'stable' not found; did you mean: stableenrich, stablestudio, stablesocial?",
    ],
    ["enrich", "service 'enrich' not found; did you mean: stableenrich?"],
    ["Weather", "service 'Weather' not found; did you mean: weather?"],
    ["wether", "service 'wether' not found; did you mean: weather?"],
    ["weather-api", "service 'weather-api' not found; did you mean: weather?"],
    ["zzzzzz", "service 'zzzzzz' not found"],
    ["a".repeat(65), `service '${"a".repeat(65)}' not found`],
    [`${"b".repeat(64)}c`, `service '${"b".repeat(64)}c' not found`],
  ])("reports unknown service id %j with suggestions", async (serviceId, message) => {
    mockFetchOk({
      services: [
        "stableenrich",
        "stablestudio",
        "stablesocial",
        "stableemail",
        "weather",
        "b".repeat(64),
        "b".repeat(66),
      ].map((id) => ({ id, name: id })),
    });

    await expect(showService({ serviceId })).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      exitCode: 2,
      message,
    });
  });

  describe("cache", () => {
    const minute = 60_000;
    const cachedDirectory = JSON.stringify({ services: [{ id: "weather", name: "Cached" }] });
    const fetchedDirectory = JSON.stringify({ services: [{ id: "weather", name: "Fetched" }] });

    async function writeCache(text: string, ageMs: number) {
      const path = serviceDirectoryCachePath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      // Whole seconds keep the reported fetched_at exact across filesystems.
      const fetchedAt = new Date(Math.floor((Date.now() - ageMs) / 1000) * 1000);
      await utimes(path, fetchedAt, fetchedAt);
      return fetchedAt.toISOString();
    }

    it.each([
      { name: "fetches and caches on a miss", fetches: true, result: "Fetched" },
      { name: "reuses a fresh cache", cache: cachedDirectory, age: minute, result: "Cached" },
      {
        name: "refetches an expired cache",
        cache: cachedDirectory,
        age: 11 * minute,
        fetches: true,
        result: "Fetched",
      },
      {
        name: "refetches a cache dated in the future",
        cache: cachedDirectory,
        age: -minute,
        fetches: true,
        result: "Fetched",
      },
      {
        name: "falls back to an expired cache when the fetch fails",
        cache: cachedDirectory,
        age: 11 * minute,
        fetches: true,
        fails: true,
        result: "Cached",
        stale: true,
      },
      {
        name: "bypasses a fresh cache with refresh",
        cache: cachedDirectory,
        age: minute,
        refresh: true,
        fetches: true,
        result: "Fetched",
      },
      {
        name: "does not fall back to the cache with refresh",
        cache: cachedDirectory,
        age: 11 * minute,
        refresh: true,
        fetches: true,
        fails: true,
      },
      {
        name: "replaces a corrupt cache",
        cache: '{"services":',
        age: minute,
        fetches: true,
        result: "Fetched",
      },
      {
        name: "fails when the only cache is corrupt",
        cache: '{"services":',
        age: 11 * minute,
        fetches: true,
        fails: true,
      },
      { name: "fails without a cache", fetches: true, fails: true },
    ])(
      "$name",
      async ({ cache, age = 0, refresh, fetches = false, fails = false, result, stale }) => {
        const fetchedAt = cache === undefined ? undefined : await writeCache(cache, age);
        const fetch = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async () =>
            fails ? new Response(null, { status: 503 }) : new Response(fetchedDirectory),
          );
        const warn = vi.spyOn(console, "error").mockImplementation(() => {});

        const detail = showService({ serviceId: "weather", refresh }).catch((e) => e);
        if (result) {
          const expected = stale
            ? { name: result, stale: true, fetched_at: fetchedAt }
            : { name: result };
          expect(await detail).toEqual(expect.objectContaining(expected));
          if (!stale) expect(await detail).not.toHaveProperty("stale");
        } else {
          expect(await detail).toMatchObject({
            code: "E_HTTP",
            message: "Failed to fetch service directory: HTTP 503",
          });
        }

        expect(fetch).toHaveBeenCalledTimes(fetches ? 1 : 0);
        expect(warn).toHaveBeenCalledTimes(stale ? 1 : 0);
        if (stale)
          expect(warn).toHaveBeenCalledWith(
            `Warning: Failed to fetch service directory: HTTP 503; using the cached service directory from ${fetchedAt}`,
          );
        const cacheAfter = await readFile(serviceDirectoryCachePath(), "utf8").catch(
          () => undefined,
        );
        expect(cacheAfter).toBe(fetches && !fails ? fetchedDirectory : cache);

        // Lists carry the same provenance for MCP results.
        if (result)
          expect(staleListFetchedAt(await listServices({ refresh }))).toBe(
            stale ? fetchedAt : undefined,
          );
      },
    );

    it("returns the directory when the cache cannot be written", async () => {
      const path = serviceDirectoryCachePath();
      await mkdir(path, { recursive: true });
      mockFetchText(fetchedDirectory);

      expect(await showService({ serviceId: "weather" })).toMatchObject({ name: "Fetched" });
      expect(await readdir(dirname(path))).toEqual(["services-cache.json"]);
    });
  });

  it("requests the public directory URL with a timeout", async () => {
    const fetch = mockFetchOk(serviceDirectory);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await listServices();

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
      "Failed to fetch service directory: terminated",
      async () =>
        ({
          ok: true,
          status: 200,
          text: async (): Promise<string> => Promise.reject(new TypeError("terminated")),
        }) as Response,
    ],
    [
      "a malformed body",
      "E_NETWORK",
      "Failed to fetch service directory: Unexpected end of JSON input",
      async () => new Response(""),
    ],
    [
      "an oversized body",
      "E_NETWORK",
      "Failed to fetch service directory: response is larger than 5 MB",
      async () => new Response(`{"services":[],"pad":"${"x".repeat(5 * 1024 * 1024)}"}`),
    ],
    [
      "a body without a services list",
      "E_NETWORK",
      "Failed to fetch service directory: response has no services list",
      async () => new Response("{}"),
    ],
  ])("maps %s to %s", async (_name, code, message, fetch) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    await expect(listServices()).rejects.toMatchObject({
      code,
      exitCode: 3,
      message,
      retryable: code === "E_NETWORK",
    });
  });

  it("never caches a directory response without a services list", async () => {
    await useTempHome();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ services: [{ id: "stableenrich" }] })));
    await expect(listServices()).rejects.toMatchObject({ code: "E_NETWORK" });
    await expect(readFile(serviceDirectoryCachePath(), "utf8")).rejects.toThrow();
    expect((await listServices()).map((service) => service.id)).toEqual(["stableenrich"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a cached file without a services list", async () => {
    await useTempHome();
    await mkdir(dirname(serviceDirectoryCachePath()), { recursive: true });
    await writeFile(serviceDirectoryCachePath(), "{}");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ services: [{ id: "stableenrich" }] })),
    );
    expect((await listServices()).map((service) => service.id)).toEqual(["stableenrich"]);
  });
});
