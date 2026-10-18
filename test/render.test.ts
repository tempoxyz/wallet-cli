import { z } from "incur";
import { describe, expect, it } from "vitest";

import { humanize, renderError, renderResult, shorten, type Cta } from "../src/cli/render.js";
import { addressOutput } from "../src/schemas/address.js";
import { balanceOutput } from "../src/schemas/balance.js";
import { configOutput } from "../src/schemas/config.js";
import { doctorOutput } from "../src/schemas/doctor.js";
import { fundOutput } from "../src/schemas/fund.js";
import { keysOutput } from "../src/schemas/keys.js";
import { sendOutput } from "../src/schemas/send.js";
import { serviceDetailOutput, servicesListOutput } from "../src/schemas/services.js";
import { sessionsListOutput } from "../src/schemas/sessions.js";
import { swapOutput } from "../src/schemas/swap.js";
import { transferOutput } from "../src/schemas/transfer.js";
import { txStatusOutput } from "../src/schemas/tx.js";
import { whoamiOutput } from "../src/schemas/whoami.js";

const wallet = "0xabfb663c1f9cd7438f54846d6b827e315719ec0f";
const key = "0x4cdadb819a7fc083b72ada08288a96424f34c8a0";
const usdc = "0x20c000000000000000000000b9537d11c60e8b50";
const pathUsd = "0x20c0000000000000000000000000000000000000";
const ousd = "0x20c0000000000000000000006a37da5c996874be";
const recipient = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const txHash = `0x${"c".repeat(64)}`;
const mainnet = { chain_id: 4217, network: "tempo" };

const next = (instruction: string, argv: string[], extra = {}) => ({
  instruction,
  _next: { argv, command: argv.join(" "), ...extra },
});

const limit = {
  unlimited: false,
  symbol: "USDC.e",
  token: usdc,
  limit: "100",
  raw_limit: "100000000",
  period_seconds: null,
  remaining: "92.5",
  spent: null,
};

const accessKey = {
  address: key,
  ...mainnet,
  wallet,
  symbol: "USDC.e",
  token: usdc,
  balance: "5.89",
  spending_limit: { mode: "restricted", ...limit },
  spending_limits: [limit],
  call_permissions: "unrestricted",
  scopes: [],
  status: "ready",
  published: true,
  expires_at: "2033-05-18T03:33:20Z",
};

const session = (channel: string, origin: string, deposit: string, remaining: string) => ({
  channel_id: `0x${channel.repeat(64)}`,
  network: "tempo",
  origin,
  symbol: "USDC.e",
  deposit,
  spent: "0.002",
  remaining,
  status: "active",
  created_at: "2026-10-01T12:00:00Z",
  last_used_at: "2026-10-02T09:30:00Z",
});

const weather = {
  id: "weather",
  name: "Weather API",
  url: "https://weather.example.com",
  service_url: "https://weather.mpp.tempo.xyz",
  description: "Forecasts and current conditions",
  categories: ["data", "climate"],
  tags: ["forecast", "meteorology"],
  endpoint_count: 1,
};

const swapQuote = {
  ...mainnet,
  mode: "exact_in",
  from: wallet,
  dex: "0xdec0000000000000000000000000000000000000",
  token_in: usdc,
  token_in_symbol: "USDC.e",
  token_out: pathUsd,
  token_out_symbol: "pathUSD",
  amount_in: "1",
  max_amount_in: "1",
  amount_out: "0.9985",
  min_amount_out: "0.993507",
  slippage_bps: 50,
  fee_token: usdc,
  access_key_limit: "100",
  requires_access_key_update: false,
  calls: [
    { to: usdc, data: "0x095ea7b3" },
    { to: "0xdec0000000000000000000000000000000000000", data: "0xf8856c0f" },
  ],
};

/** A command's output with the schema it is rendered from; each has a snapshot of its view. */
const results: { name: string; schema: z.ZodType; data: unknown; cta?: Cta }[] = [
  { name: "address", schema: addressOutput, data: { address: wallet, ...mainnet } },
  {
    name: "address-cta",
    schema: addressOutput,
    data: { address: wallet, ...mainnet },
    cta: {
      commands: [{ command: "tempo wallet skills add", description: "sync outdated skills" }],
    },
  },
  {
    name: "balance",
    schema: balanceOutput,
    data: {
      wallet,
      ...mainnet,
      balances: [
        { token: ousd, symbol: "OUSD", decimals: 6, balance: "1.5", verified: true },
        {
          token: "0x20c000000000000000000000000000000000beef",
          symbol: null,
          decimals: 18,
          balance: "2.5",
          verified: false,
        },
        { token: usdc, symbol: "USDC.e", decimals: 6, balance: "0", verified: true },
      ],
    },
  },
  {
    name: "whoami",
    schema: whoamiOutput,
    data: {
      ready: true,
      wallet,
      ...mainnet,
      balance: {
        total: "8.396",
        locked: "2.506",
        pending_refund: "0",
        available: "5.89",
        active_sessions: 2,
        symbol: "USDC.e",
      },
      balances: [
        {
          token: ousd,
          symbol: "OUSD",
          decimals: 6,
          balance: "1.5",
          verified: true,
          access_key_limit: null,
        },
        {
          token: usdc,
          symbol: "USDC.e",
          decimals: 6,
          balance: "5.89",
          verified: true,
          access_key_limit: "100",
        },
      ],
      key: (({ wallet: _, ...rest }) => rest)(accessKey),
    },
  },
  {
    name: "whoami-logged-out",
    schema: whoamiOutput,
    data: {
      ready: false,
      wallet: null,
      ...mainnet,
      balance: {
        total: null,
        locked: "0",
        pending_refund: "0",
        available: null,
        active_sessions: 0,
        symbol: "USDC.e",
        error: { code: "E_RPC", message: "Balance query failed" },
      },
      balances: [],
      key: null,
    },
  },
  {
    name: "whoami-mach",
    schema: whoamiOutput,
    data: {
      mach: {
        wallet,
        ...mainnet,
        token: "0x20c000000000000000000000f37de3740adec032",
        symbol: "MACH",
        decimals: 6,
        balance: "1.25",
        raw_balance: "1250000",
      },
    },
  },
  { name: "keys-list", schema: keysOutput, data: { keys: [accessKey], total: 1 } },
  {
    name: "sessions-list",
    schema: sessionsListOutput,
    data: {
      ...mainnet,
      sessions: [
        session("a", "https://api.example.test", "0.01", "0.008"),
        session("b", "https://other.example.test", "2.5", "2.498"),
      ],
      total: 2,
    },
  },
  {
    name: "services-list",
    schema: servicesListOutput,
    data: [
      weather,
      { ...weather, id: "maps", name: "Maps", categories: [], tags: [], endpoint_count: 0 },
    ],
  },
  {
    name: "services-show",
    schema: serviceDetailOutput,
    data: {
      ...weather,
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
            unit_type: "request",
            description: "",
            dynamic: false,
          },
          docs: null,
        },
      ],
    },
  },
  {
    name: "config-get",
    schema: configOutput,
    data: {
      network: { value: "mainnet", source: "login" },
      "rpc-url": {
        mainnet: { value: "https://rpc.tempo.xyz", source: "default" },
        testnet: { value: "https://rpc.moderato.tempo.xyz", source: "config" },
      },
      "max-spend": { value: "10", source: "default" },
    },
  },
  {
    name: "doctor",
    schema: doctorOutput,
    data: {
      ...mainnet,
      versions: {
        wallet_cli: "0.14.0",
        node: "v24.13.0",
        platform: "darwin",
        arch: "arm64",
        incur: "0.7.1",
        accounts: "0.21.0",
      },
      wallet: {
        logged_in: true,
        address: wallet,
        type: "device_code",
        chain_id: 4217,
        network: "tempo",
        private_key_env: false,
      },
      key: {
        address: key,
        status: "ready",
        expires_at: "2033-05-18T03:33:20Z",
        spending_limits: [limit],
      },
      rpc: {
        url: "https://rpc.tempo.xyz",
        ok: true,
        chain_id: 4217,
        chain_matches: true,
        latency_ms: 42,
      },
      auth: { url: "https://wallet.tempo.xyz" },
      sqlite3: { found: false, version: null },
      session_store: { path: "/home/user/.tempo/wallet/channels.db", exists: true, readable: true },
      env: [{ name: "TEMPO_RPC_URL", value: "https://rpc.tempo.xyz" }],
      checks: [
        { name: "wallet", status: "ok", message: `Logged in as ${wallet} on mainnet.` },
        {
          name: "rpc",
          status: "warn",
          message: "RPC https://rpc.tempo.xyz answered in 1200ms, which is slow.",
        },
        {
          name: "sqlite3",
          status: "fail",
          message:
            "sqlite3 is not installed; sessions cannot be stored. Install sqlite3 and rerun doctor.",
        },
      ],
      ...next("sqlite3 is not installed. Install sqlite3, then run the next command.", [
        "tempo",
        "wallet",
        "doctor",
        "--network",
        "mainnet",
      ]),
    },
  },
  {
    name: "tx",
    schema: txStatusOutput,
    data: {
      tx_hash: txHash,
      ...mainnet,
      status: "success",
      block_number: 1234567,
      from: wallet,
      to: recipient,
      fee: "0.0012",
      fee_token: usdc,
    },
  },
  {
    name: "tx-pending",
    schema: txStatusOutput,
    data: {
      tx_hash: txHash,
      ...mainnet,
      status: "pending",
      block_number: null,
      from: wallet,
      to: recipient,
      fee: null,
      fee_token: null,
      ...next(
        "The transaction is pending. Rerun the next command until its status is no longer pending.",
        ["tempo", "wallet", "tx", "status", txHash, "--network", "mainnet"],
        { until: '.status != "pending"', poll_interval_seconds: 1 },
      ),
    },
  },
  {
    name: "send-dry-run",
    schema: sendOutput,
    data: {
      status: "dry_run",
      ...mainnet,
      amount: "1.5",
      symbol: "USDC.e",
      token: usdc,
      to: recipient,
      from: wallet,
      fee_token: pathUsd,
      fee_estimate: "0.001",
      balance: "5.89",
      fee_token_balance: "1.25",
      sufficient_balance: true,
      ...next(
        `Review the transfer, then run the next command to send 1.5 USDC.e to ${recipient}.`,
        ["tempo", "wallet", "send", "1.5", usdc, recipient, "--yes", "--network", "mainnet"],
      ),
    },
  },
  {
    name: "send",
    schema: sendOutput,
    data: {
      status: "success",
      tx_hash: txHash,
      ...mainnet,
      amount: "1.5",
      symbol: "USDC.e",
      token: usdc,
      to: recipient,
      from: wallet,
    },
  },
  {
    name: "swap-dry-run",
    schema: swapOutput,
    data: {
      status: "dry_run",
      ...swapQuote,
      ...next(
        "Review the quote, then run the next command to submit it. Submission re-quotes and refuses to receive less than 0.993507 pathUSD.",
        ["tempo", "wallet", "swap", "1", usdc, pathUsd, "--min-amount-out", "0.993507", "--yes"],
      ),
    },
  },
  {
    name: "fund-pending",
    schema: fundOutput,
    data: {
      status: "pending",
      wallet,
      action: "fund",
      url: "https://wallet.tempo.xyz/fund?address=0xabfb",
      ...mainnet,
      token: usdc,
      symbol: "USDC.e",
      amount: null,
      balance: "5.89",
      raw_balance: "5890000",
      ...next(
        "Have the user open url and finish funding. Then run the next command to wait for the funds to arrive.",
        ["tempo", "wallet", "fund", "status", "--network", "mainnet"],
        { until: '.status != "pending"', poll_interval_seconds: 2 },
      ),
    },
  },
];

const errors: {
  name: string;
  error: { message: string; fieldErrors?: { path: string; message: string }[] };
  cta?: Cta;
}[] = [
  {
    name: "error",
    error: {
      message:
        "No wallet is logged in. Run 'tempo wallet login --network mainnet' before retrying, or set TEMPO_PRIVATE_KEY.",
    },
    cta: { commands: [{ command: "tempo wallet login --network mainnet" }] },
  },
  {
    name: "error-fields",
    error: {
      message: "Invalid options",
      fieldErrors: [{ path: "amount", message: "Expected a positive amount" }],
    },
  },
  {
    name: "error-multiline",
    error: { message: "The RPC request failed.\n\nURL: https://rpc.tempo.xyz\nDetails: timeout" },
  },
];

const options = { color: false, width: 80 };

function view(row: (typeof results)[number] | (typeof errors)[number], width = options.width) {
  return "schema" in row
    ? renderResult(row.data, row.schema, row.cta, { ...options, width })
    : renderError(row.error, row.cta, { ...options, width });
}

describe("human view", () => {
  it.each([...results, ...errors])("$name", async (row) => {
    // Each fixture is real command output, so the view renders what the command returns.
    if ("schema" in row) expect(row.schema.safeParse(row.data).success).toBe(true);
    await expect(`${view(row)}\n`).toMatchFileSnapshot(`./__snapshots__/render/${row.name}.txt`);
  });

  it.each([...results, ...errors])("$name fits 80 columns", (row) => {
    // Errors, notes, and `Next:` commands are left for the terminal to wrap, so a command quoted
    // in them copies as one line; everything aligned fits.
    const prose = new Set(
      "schema" in row
        ? [(row.data as { instruction?: string }).instruction]
        : row.error.message.split("\n").map((line, index) => (index ? line : `Error: ${line}`)),
    );
    const wide = view(row)
      .split("\n")
      .filter((line) => line.length > 80 && !line.startsWith("Next: ") && !prose.has(line));
    expect(wide).toEqual([]);
  });

  it("lays a list that cannot fit as a table out as blocks, and as a table when it fits", () => {
    const sessions = results.find((row) => row.name === "sessions-list")!;
    expect(view(sessions)).toContain("Sessions\n  Channel ID    0xaaaa…aaaa\n");
    expect(view(sessions, 160)).toContain(
      "Sessions\n  Channel ID   Network  Origin                      Deposit      Spent",
    );
  });

  it.each([
    {
      name: "a key limit in a token of unknown decimals shows its raw limit",
      schema: keysOutput,
      data: {
        keys: [
          {
            ...accessKey,
            spending_limits: [
              { ...limit, symbol: null, limit: null, raw_limit: "1500000000000000000" },
            ],
          },
        ],
        total: 1,
      },
      shown: ["1500000000000000000"],
      hidden: [],
    },
    {
      name: "a formatted key limit leaves its raw limit out",
      schema: keysOutput,
      data: { keys: [accessKey], total: 1 },
      shown: ["100 USDC.e"],
      hidden: ["Raw limit", "100000000"],
    },
    {
      name: "a price the directory gives no decimals for shows its raw amount",
      schema: serviceDetailOutput,
      data: {
        ...weather,
        endpoints: [
          {
            method: "GET",
            path: "/now",
            description: "",
            payment: {
              intent: "pay",
              raw_amount: "100",
              decimals: null,
              price: null,
              unit_type: null,
              description: "",
              dynamic: null,
            },
            docs: null,
          },
        ],
      },
      shown: ["Raw amount   100"],
      hidden: [],
    },
    {
      name: "a dry run whose fee reads failed still names its fee token",
      schema: sendOutput,
      data: {
        ...(results.find((row) => row.name === "send-dry-run")!.data as object),
        fee_estimate: null,
        fee_token_balance: null,
      },
      shown: ["Fee token           0x20c0…0000", "Fee estimate        -"],
      hidden: [],
    },
    {
      name: "a dry run whose fee reads succeeded shows its fee token with each amount",
      schema: sendOutput,
      data: results.find((row) => row.name === "send-dry-run")!.data,
      shown: ["Fee estimate        0.001 0x20c0…0000"],
      hidden: ["Fee token   "],
    },
    {
      name: "a MACH transfer shows its amount in MACH, from the union option it is",
      schema: transferOutput,
      data: {
        status: "success",
        wallet,
        amount: "1",
        raw_amount: "1000000",
        token: "MACH",
        settlement_currency: usdc,
        ...mainnet,
        challenge_id: "challenge-1",
        max_spend: "5",
        tx_hash: txHash,
      },
      shown: ["1 MACH"],
      hidden: ["Raw amount", "Token  "],
    },
  ])("$name", ({ schema, data, shown, hidden }) => {
    expect(schema.safeParse(data).success).toBe(true);
    const text = renderResult(data, schema, undefined, options);
    for (const line of shown) expect(text).toContain(line);
    for (const line of hidden) expect(text).not.toContain(line);
  });

  it("colors a sent send's status from the union option it is", () => {
    const sent = results.find((row) => row.name === "send")!;
    expect(renderResult(sent.data, sent.schema, undefined, { color: true, width: 80 })).toContain(
      "\u001b[32msuccess\u001b[39m",
    );
  });

  it("colors labels dim, successes green, and failures red", () => {
    const color = { color: true, width: 80 };
    const doctor = results.find((row) => row.name === "doctor")!;
    const text = renderResult(doctor.data, doctor.schema, undefined, color);
    expect(text).toContain("\u001b[2mChain ID\u001b[22m  4217");
    expect(text).toContain("\u001b[32mok\u001b[39m");
    expect(text).toContain("\u001b[31mfail\u001b[39m");
    expect(text).toContain("\u001b[2mNext:\u001b[22m tempo wallet doctor");
    expect(renderError({ message: "Nope" }, undefined, color)).toBe(
      "\u001b[31mError:\u001b[39m Nope",
    );
    expect(renderResult(doctor.data, doctor.schema, undefined, options)).not.toContain("\u001b");
  });

  it.each([
    ["chain_id", "Chain ID"],
    ["tx_hash", "Tx hash"],
    ["rpc-url", "RPC URL"],
    ["max-spend", "Max spend"],
    ["service_url", "Service URL"],
    ["wallet_cli", "Wallet CLI"],
    ["remaining_seconds", "Remaining seconds"],
    ["llms_txt", "Llms txt"],
    ["api_reference", "API reference"],
    ["tokenIn", "Token in"],
    ["_next", "Next"],
    ["ok", "OK"],
  ])("labels %s as %s", (key, label) => {
    expect(humanize(key)).toBe(label);
  });

  it.each([
    [usdc, "0x20c0…8b50"],
    [txHash, "0xcccc…cccc"],
    ["0x1234", "0x1234"],
    ["USDC.e", "USDC.e"],
  ])("shortens %s to %s", (text, short) => {
    expect(shorten(text)).toBe(short);
  });

  // The hints are registered with `displayMeta`, not `.meta()`, so the JSON Schema that
  // `--schema`, `--llms-full`, and MCP tools print stays as it was.
  it.each(results.map(({ name, schema }) => ({ name, schema })))(
    "$name keeps display hints out of its JSON Schema",
    ({ schema }) => {
      expect(schemaKeywords(z.toJSONSchema(schema))).not.toContain(
        expect.stringMatching(/^(amount|address|hidden|next|note|tone)$/),
      );
    },
  );
});

/** Every keyword of a JSON Schema, leaving out the property names under `properties`. */
function schemaKeywords(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(schemaKeywords);
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) =>
    key === "properties"
      ? Object.values(value as object).flatMap(schemaKeywords)
      : [key, ...schemaKeywords(value)],
  );
}
