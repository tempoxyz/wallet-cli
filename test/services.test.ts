import { execFile } from "node:child_process";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeServicesArgs, servicesSubcommands } from "../src/cli/argv.js";
import { commandMap } from "../src/cli/command.js";
import services from "../src/commands/services/index.js";
import { cliBundle } from "./cli-bundle.js";
import { useTempHome } from "./helpers.js";

const fixtures = join(import.meta.dirname, "fixtures");

const showNotice =
  "Warning: 'tempo wallet services <id>' is deprecated; use 'tempo wallet services show <id>'.";
const searchNotice =
  "Warning: 'tempo wallet services --search <query>' is deprecated; use 'tempo wallet services search <query>'.";

describe("normalizeServicesArgs", () => {
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  let warn: ReturnType<typeof vi.spyOn>;

  function setStdoutTTY(value: boolean | undefined) {
    Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  }

  beforeEach(() => {
    warn = vi.spyOn(console, "error").mockImplementation(() => {});
    setStdoutTTY(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it("knows every mounted services subcommand", () => {
    expect([...commandMap(services.command!).keys()]).toEqual(servicesSubcommands);
  });

  // [argv, what incur gets, the notice on a terminal]; a subcommand comes just after `services`,
  // then its one value, then the flags.
  it.each<[string[], string[], string?]>([
    // Current forms.
    [["services"], ["services"]],
    [
      ["services", "--refresh"],
      ["services", "--refresh"],
    ],
    [
      ["services", "list"],
      ["services", "list"],
    ],
    [
      ["services", "search", "ai"],
      ["services", "search", "ai"],
    ],
    [
      ["services", "show", "weather"],
      ["services", "show", "weather"],
    ],
    [
      ["services", "--refresh", "list"],
      ["services", "list", "--refresh"],
    ],
    [
      ["services", "show", "weather", "extra"],
      ["services", "show", "weather"],
    ],
    [
      ["services", "--filter-output", "id"],
      ["services", "--filter-output", "id"],
    ],
    [
      ["whoami", "weather"],
      ["whoami", "weather"],
    ],
    // An unquoted query is one query.
    [
      ["services", "search", "image", "generation"],
      ["services", "search", "image generation"],
    ],
    [
      ["services", "search", "image", "-v", "generation"],
      ["services", "search", "image generation", "-v"],
    ],
    // A subcommand name wins over an id; `show` reaches services with those ids.
    [
      ["services", "search"],
      ["services", "search"],
    ],
    [
      ["services", "show"],
      ["services", "show"],
    ],
    [
      ["services", "show", "list"],
      ["services", "show", "list"],
    ],
    [
      ["services", "show", "search"],
      ["services", "show", "search"],
    ],
    // `true` or `false` after a boolean flag is its value, not an id.
    [["services", "--refresh", "false"], ["services"]],
    [
      ["services", "--refresh", "false", "list"],
      ["services", "list"],
    ],
    [
      ["services", "--refresh", "true", "list"],
      ["services", "list", "--refresh"],
    ],
    [
      ["services", "show", "-v", "false", "weather"],
      ["services", "show", "weather"],
    ],
    [["services", "--refresh", "false", "weather"], ["services", "show", "weather"], showNotice],
    [
      ["services", "--refresh", "true", "weather"],
      ["services", "show", "weather", "--refresh"],
      showNotice,
    ],
    // Everything after `--` is a positional, and none is passed on as a flag.
    [
      ["services", "show", "--", "weather"],
      ["services", "show", "weather"],
    ],
    [
      ["services", "search", "--", "--mcp"],
      ["services", "search", "mcp"],
    ],
    [["services", "--", "weather"], ["services", "show", "weather"], showNotice],
    [["services", "--", "edgar-search"], ["services", "show", "edgar-search"], showNotice],
    [["services", "--", "--mcp"], ["services", "show"], showNotice],
    // `services <id>` is `services show <id>`, including ids incur takes for a subcommand typo.
    [["services", "weather"], ["services", "show", "weather"], showNotice],
    [["services", "edgar-search"], ["services", "show", "edgar-search"], showNotice],
    [["services", "aisa"], ["services", "show", "aisa"], showNotice],
    [
      ["services", "edgar-search", "--help"],
      ["services", "show", "edgar-search", "--help"],
      showNotice,
    ],
    [
      ["services", "--refresh", "weather"],
      ["services", "show", "weather", "--refresh"],
      showNotice,
    ],
    [
      ["-n", "testnet", "services", "weather"],
      ["-n", "testnet", "services", "show", "weather"],
      showNotice,
    ],
    // An id wins over `--search`, as it did.
    [["services", "weather", "--search", "ai"], ["services", "show", "weather"], showNotice],
    [["services", "--search", "", "weather"], ["services", "show", "weather"], showNotice],
    // `services [list] --search <query>` is `services search <query>`.
    [["services", "--search", "ai"], ["services", "search", "ai"], searchNotice],
    [["services", "--search=ai"], ["services", "search", "ai"], searchNotice],
    [
      ["services", "list", "--search", "image generation", "--refresh"],
      ["services", "search", "image generation", "--refresh"],
      searchNotice,
    ],
    [["services", "--search", "ai", "list"], ["services", "search", "ai"], searchNotice],
    [["services", "--search", "old", "--search", "ai"], ["services", "search", "ai"], searchNotice],
    // An empty query still lists everything.
    [["services", "--search", ""], ["services", "search", ""], searchNotice],
    [["services", "--search="], ["services", "search", ""], searchNotice],
    [["services", "--search", "--"], ["services", "search", ""], searchNotice],
    [["services", "--search=--"], ["services", "search", ""], searchNotice],
    [
      ["services", "--search", "", "--refresh"],
      ["services", "search", "", "--refresh"],
      searchNotice,
    ],
    // A query that looks like a flag is never passed on as one; search ignores dashes.
    [["services", "--search=--mcp"], ["services", "search", "mcp"], searchNotice],
    [["services", "--search", "--mcp"], ["services", "search", "mcp"], searchNotice],
    [["services", "--search=--help"], ["services", "search", "help"], searchNotice],
    [["services", "--search=-foo"], ["services", "search", "foo"], searchNotice],
    [["services", "--search", "-foo"], ["services", "search", "foo"], searchNotice],
    // Output aliases become `--format`, and an explicit format is an agent's: no notice.
    [
      ["services", "-j", "weather"],
      ["services", "show", "weather", "--format", "json"],
    ],
    [
      ["services", "weather", "--json"],
      ["services", "show", "weather", "--json"],
    ],
    [
      ["services", "--search", "ai", "--format", "toon"],
      ["services", "search", "ai", "--format", "toon"],
    ],
  ])("rewrites %j to %j", (args, expected, notice) => {
    expect(normalizeServicesArgs(args)).toEqual(expected);
    expect(warn.mock.calls).toEqual(notice ? [[notice]] : []);
  });

  it.each([
    ["--", "services", "we"],
    ["--", "services", "--search", "fo"],
    ["--", "services", "--refresh", "false", ""],
  ])("leaves the completion words %j in place", (...args) => {
    vi.stubEnv("COMPLETE", "bash");
    expect(normalizeServicesArgs(args)).toEqual(args);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("prints no notice when stdout isTTY is %j", (value) => {
    setStdoutTTY(value);
    expect(normalizeServicesArgs(["services", "weather"])).toEqual(["services", "show", "weather"]);
    expect(normalizeServicesArgs(["services", "--search", "ai"])).toEqual([
      "services",
      "search",
      "ai",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("tempo wallet services", () => {
  let home: string;

  beforeEach(async () => {
    home = await useTempHome();
  });

  // Each form against the subcommand it runs, both against the mock directory: `weather`, then
  // services named `list`, `search`, `show`, and `edgar-search`.
  it.each([
    { command: ["services", "list"], form: ["services"], data: { length: 5 } },
    {
      command: ["services", "show", "weather"],
      form: ["services", "weather"],
      data: { id: "weather" },
      notice: showNotice,
    },
    {
      command: ["services", "show", "edgar-search"],
      form: ["services", "edgar-search"],
      data: { id: "edgar-search" },
      notice: showNotice,
    },
    {
      command: ["services", "search", "forecast"],
      form: ["services", "--search", "forecast"],
      data: [{ id: "weather" }],
      notice: searchNotice,
    },
    {
      command: ["services", "search", "forecast"],
      form: ["services", "list", "--search", "forecast"],
      data: [{ id: "weather" }],
      notice: searchNotice,
    },
    {
      command: ["services", "list"],
      form: ["services", "--search", ""],
      data: { length: 5 },
      notice: searchNotice,
    },
    {
      command: ["services", "list"],
      form: ["services", "--search", "--"],
      data: { length: 5 },
      notice: searchNotice,
    },
    {
      command: ["services", "list"],
      form: ["services", "--search=--"],
      data: { length: 5 },
      notice: searchNotice,
    },
    {
      command: ["services", "search", "forecast conditions"],
      form: ["services", "search", "forecast", "conditions"],
      data: [{ id: "weather" }],
    },
    {
      command: ["services", "list"],
      form: ["services", "--refresh", "false", "list"],
      data: { length: 5 },
    },
    {
      command: ["services", "show", "weather"],
      form: ["services", "--refresh", "false", "weather"],
      data: { id: "weather" },
      notice: showNotice,
    },
    {
      command: ["services", "show", "edgar-search"],
      form: ["services", "--", "edgar-search"],
      data: { id: "edgar-search" },
      notice: showNotice,
    },
  ])(
    "$form returns what $command does, with any deprecation noted on a terminal only",
    async ({ command, form, data, notice }) => {
      const [commandJson, formJson] = await Promise.all([
        wallet(["--format", "json", ...command], home),
        wallet(["--format", "json", ...form], home),
      ]);
      expect(formJson).toEqual(commandJson);
      expect(commandJson).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(commandJson.stdout)).toMatchObject(data);

      const [commandTerminal, formTerminal] = await Promise.all([
        wallet(command, home, { terminal: true }),
        wallet(form, home, { terminal: true }),
      ]);
      expect(formTerminal.stdout).toBe(commandTerminal.stdout);
      expect(commandTerminal.stderr).toBe("");
      expect(formTerminal.stderr).toBe(notice ? `${notice}\n` : "");
    },
  );

  it.each([
    { args: ["services", "show", "list"], id: "list" },
    { args: ["services", "show", "search"], id: "search" },
    { args: ["services", "show", "show"], id: "show" },
  ])("$args shows the service whose id names a subcommand", async ({ args, id }) => {
    const result = await wallet([...args, "--format", "json"], home);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      id,
      service_url: `https://${id}.example.com`,
    });
  });

  it.each([
    { args: ["services", "search"], missing: "query" },
    { args: ["services", "show"], missing: "serviceId" },
  ])("$args is the subcommand, not a lookup", async ({ args, missing }) => {
    const result = await wallet([...args, "--format", "json"], home);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [expect.objectContaining({ missing: true, path: missing })],
    });
  });

  // A query that looks like an entrypoint flag is searched for, never run as `--mcp` or `--help`.
  it.each([
    ["services", "--search=--mcp"],
    ["services", "--search", "--mcp"],
    ["services", "search", "--", "--mcp"],
    ["services", "--search=--help"],
    ["services", "--search=-foo"],
    ["services", "--search", "-foo"],
  ])("%j searches for its query", async (...args) => {
    const result = await wallet(["--format", "json", ...args], home);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it.each([
    ["services", "edgar-search", "--help"],
    ["help", "services", "edgar-search"],
    ["help", "services", "weather"],
  ])("%j shows the help of services show", async (...args) => {
    const result = await wallet(args, home);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: tempo wallet services show <serviceId> [options]");
  });

  it.each([
    ["services", "show", "wether"],
    ["services", "wether"],
  ])("%j suggests close ids for an unknown one", async (...args) => {
    const result = await wallet([...args, "--format", "json"], home);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "E_NOT_FOUND",
      message: "service 'wether' not found; did you mean: weather?",
    });
  });
});

/** Runs the wallet CLI against the mock service directory, with stdout a terminal on request. */
function wallet(args: string[], home: string, { terminal = false } = {}) {
  const imports = [
    "--import",
    join(fixtures, "mock-services-fetch.mjs"),
    ...(terminal ? ["--import", join(fixtures, "interactive-stdout.mjs")] : []),
  ];
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [...imports, cliBundle("wallet"), ...args],
      { env: { ...process.env, HOME: home, NO_COLOR: "1" }, timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
