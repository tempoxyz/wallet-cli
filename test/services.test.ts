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
    warn.mockRestore();
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it("knows every mounted services subcommand", () => {
    expect([...commandMap(services.command!).keys()]).toEqual(servicesSubcommands);
  });

  it.each([
    // Current forms are left as they are, with a subcommand moved to just after `services`.
    { args: ["services"], expected: ["services"] },
    { args: ["services", "--refresh"], expected: ["services", "--refresh"] },
    { args: ["services", "list"], expected: ["services", "list"] },
    { args: ["services", "search", "ai"], expected: ["services", "search", "ai"] },
    { args: ["services", "show", "weather"], expected: ["services", "show", "weather"] },
    { args: ["services", "--refresh", "list"], expected: ["services", "list", "--refresh"] },
    {
      args: ["services", "--filter-output", "id"],
      expected: ["services", "--filter-output", "id"],
    },
    { args: ["whoami", "weather"], expected: ["whoami", "weather"] },
    // Shell completion passes its words after `--`.
    { args: ["--", "services", "we"], expected: ["--", "services", "we"] },
    // A subcommand name wins over an id; `show` reaches services with those ids.
    { args: ["services", "search"], expected: ["services", "search"] },
    { args: ["services", "show"], expected: ["services", "show"] },
    { args: ["services", "show", "list"], expected: ["services", "show", "list"] },
    { args: ["services", "show", "search"], expected: ["services", "show", "search"] },
    // `services <id>` is `services show <id>`, including ids incur takes for a subcommand typo.
    {
      args: ["services", "weather"],
      expected: ["services", "show", "weather"],
      notice: showNotice,
    },
    {
      args: ["services", "edgar-search"],
      expected: ["services", "show", "edgar-search"],
      notice: showNotice,
    },
    { args: ["services", "aisa"], expected: ["services", "show", "aisa"], notice: showNotice },
    {
      args: ["services", "--refresh", "weather"],
      expected: ["services", "show", "--refresh", "weather"],
      notice: showNotice,
    },
    {
      args: ["-n", "testnet", "services", "weather"],
      expected: ["-n", "testnet", "services", "show", "weather"],
      notice: showNotice,
    },
    // An id wins over `--search`, as it did.
    {
      args: ["services", "weather", "--search", "ai"],
      expected: ["services", "show", "weather"],
      notice: showNotice,
    },
    // `services [list] --search <query>` is `services search <query>`.
    {
      args: ["services", "--search", "ai"],
      expected: ["services", "search", "ai"],
      notice: searchNotice,
    },
    {
      args: ["services", "--search=ai"],
      expected: ["services", "search", "ai"],
      notice: searchNotice,
    },
    {
      args: ["services", "list", "--search", "image generation", "--refresh"],
      expected: ["services", "search", "image generation", "--refresh"],
      notice: searchNotice,
    },
    {
      args: ["services", "--search", "ai", "list"],
      expected: ["services", "search", "ai"],
      notice: searchNotice,
    },
    {
      args: ["services", "--search", "old", "--search", "ai"],
      expected: ["services", "search", "ai"],
      notice: searchNotice,
    },
    // Output aliases become `--format`, and an explicit format is an agent's: no notice.
    {
      args: ["services", "-j", "weather"],
      expected: ["services", "show", "--format", "json", "weather"],
    },
    {
      args: ["services", "weather", "--json"],
      expected: ["services", "show", "weather", "--json"],
    },
    {
      args: ["services", "--search", "ai", "--format", "toon"],
      expected: ["services", "search", "ai", "--format", "toon"],
    },
  ])("rewrites $args", ({ args, expected, notice }) => {
    expect(normalizeServicesArgs(args)).toEqual(expected);
    expect(warn.mock.calls).toEqual(notice ? [[notice]] : []);
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
  ])(
    "$form returns what $command does, with any deprecation noted on a terminal only",
    async ({ command, form, data, notice }) => {
      const [commandJson, formJson] = await Promise.all([
        wallet([...command, "--format", "json"], home),
        wallet([...form, "--format", "json"], home),
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
