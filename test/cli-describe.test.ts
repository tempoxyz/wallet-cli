import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { Parser } from "incur";
import { describe, expect, it } from "vitest";

import { fundOptions, loginOptions, updateAccessKeyOptions } from "../src/schemas.js";
import { cliBundle } from "./cli-bundle.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

describe("generated CLI metadata", () => {
  it.each([
    ["wallet", walletCli],
    ["request", requestCli],
  ])("reports the package version for the %s entrypoint", async (_, cli) => {
    expect((await cli(["--version"])).trim()).toBe(await packageVersion());
  });

  it("documents direct service lookup and search in services help", async () => {
    const output = await walletCli(["services", "--help"]);

    expect(output).toContain("Usage: tempo wallet services [serviceId] [options]");
    expect(output).toContain("--search <string>");
    expect(output).toContain("--refresh");
    expect(output).not.toContain("Usage: tempo wallet services <command>");
  });

  it("documents access key limit updates", async () => {
    const output = await walletCli(["keys", "update", "--help"]);

    expect(output).toContain("Usage: tempo wallet keys update [accessKey] [options]");
    expect(output).toContain("--limit <string>");
    expect(output).toContain("--token <string>");
    expect(output).toContain("--no-browser");
  });

  it("documents dry-run-first wallet swaps", async () => {
    const output = await walletCli(["swap", "--help"]);

    expect(output).toContain("Usage: tempo wallet swap <amount> <tokenIn> <tokenOut> [options]");
    expect(output).toContain("--exact-out");
    expect(output).toContain("--slippage-bps <number>");
    expect(output).toContain("--min-amount-out <string>");
    expect(output).toContain("--max-amount-in <string>");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--yes");

    const description = JSON.parse(await walletCli(["--describe"])) as {
      subcommands: { name: string; args?: { long?: string | undefined }[] | undefined }[];
    };
    const swap = description.subcommands.find((command) => command.name === "swap");
    expect(swap?.args?.map((arg) => arg.long)).toEqual(
      expect.arrayContaining(["--min-amount-out", "--max-amount-in"]),
    );
  });

  it.each([
    { name: "help", read: () => walletCli(["sessions", "close", "--help"]) },
    {
      name: "--describe",
      read: async () => {
        const description = JSON.parse(await walletCli(["--describe"])) as {
          subcommands: { name: string; subcommands?: { name: string }[] | undefined }[];
        };
        const sessions = description.subcommands.find((command) => command.name === "sessions");
        return JSON.stringify(sessions?.subcommands?.find((command) => command.name === "close"));
      },
    },
  ])(
    "documents sessions close as a request followed by a withdrawal in $name",
    async ({ read }) => {
      const output = await read();

      expect(output).toContain(
        "Request a session close, then withdraw after the grace period with --finalize",
      );
      expect(output).toContain("Withdraw channels whose close grace period has ended");
      expect(output).toContain(
        "Close now through the session's server instead of waiting out the grace period",
      );
    },
  );

  it("documents request payment intent selection", async () => {
    const help = await requestCli(["--help"]);
    expect(help).toContain("--payment-intent <auto|session|charge>");
    expect(help).toContain("--payment-token <string>");
    expect(help).toContain("--mach");

    const description = JSON.parse(await requestCli(["--describe"])) as {
      args: { long?: string | undefined; name: string }[];
    };
    expect(description.args).toContainEqual(
      expect.objectContaining({ long: "--payment-intent", name: "payment_intent" }),
    );
    expect(description.args).toContainEqual(
      expect.objectContaining({ long: "--payment-token", name: "payment_token" }),
    );
  });

  it("documents that request dry-runs send the request", async () => {
    const help = "Send the request to discover the payment challenge without paying";
    expect(await requestCli(["--help"])).toContain(help);

    const description = JSON.parse(await requestCli(["--describe"])) as {
      args: { help: string; long?: string | undefined }[];
    };
    expect(description.args).toContainEqual(expect.objectContaining({ long: "--dry-run", help }));
  });

  it("documents insecure TLS and the insecure payment opt-in", async () => {
    const help = await requestCli(["--help"]);
    expect(help).toMatch(/--insecure, -k\s+Allow insecure TLS connections/);
    expect(help).toContain("--allow-insecure-payment");

    const description = JSON.parse(await requestCli(["--describe"])) as {
      args: { help: string; long?: string | undefined; name: string }[];
    };
    expect(description.args).toContainEqual(
      expect.objectContaining({
        long: "--insecure",
        help: expect.stringContaining("skips certificate verification"),
      }),
    );
    expect(description.args).toContainEqual(
      expect.objectContaining({ long: "--allow-insecure-payment", name: "allow_insecure_payment" }),
    );
  });

  it("returns a complete remote MACH handoff through the CLI", async () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const result = JSON.parse(
      await walletCli([
        "fund",
        "--mach",
        "--address",
        wallet,
        "--amount",
        "5",
        "--no-browser",
        "--format",
        "json",
        "--network",
        "mainnet",
      ]),
    );
    expect(result).toMatchObject({
      status: "pending",
      action: "mach",
      wallet,
      amount: "5",
      chain_id: 4217,
      symbol: "MACH",
      balance: null,
    });
    expect(result.url).toBe(
      `https://wallet.tempo.xyz/agent?action=fund&intent=mach&address=${wallet}&chainId=4217&amount=5`,
    );
  });

  it("exposes MACH funding controls and pending output in its schema", async () => {
    const schema = JSON.parse(await walletCli(["fund", "--schema", "--format", "json"]));
    expect(schema.options.properties).toHaveProperty("mach");
    expect(schema.options.properties).toHaveProperty("amount");
    expect(schema.options.properties.wait.default).toBe(false);
    expect(schema.output.properties.status.enum).toEqual(["success", "pending"]);
  });

  it.each([
    { command: ["swap"] },
    { command: ["transfer"] },
    { command: ["revoke"] },
    { command: ["keys", "update"] },
    { command: ["login"] },
    { command: ["sessions", "close"] },
  ])("advertises next-step fields in the $command output schema", async ({ command }) => {
    const schema = JSON.parse(await walletCli([...command, "--schema", "--format", "json"])) as {
      output: unknown;
    };
    expect(hasNextStep(schema.output)).toBe(true);
  });

  it("returns schema for the direct services command", async () => {
    const output = await walletCli(["services", "--schema", "--format", "json"]);
    const schema = JSON.parse(output) as {
      args: { properties: { serviceId: { description: string } } };
      options: { properties: { search: { description: string } } };
    };

    expect(schema.args.properties.serviceId.description).toContain("Service ID");
    expect(schema.options.properties.search.description).toContain("Search by name");
  });

  it("advertises nullable wallet balances and RPC diagnostics", async () => {
    const whoami = JSON.parse(await walletCli(["whoami", "--schema", "--format", "json"])) as {
      output: {
        anyOf: {
          properties?: {
            balance?: { properties: { available: { anyOf: { type: string }[] } } };
            key?: { anyOf: { properties?: Record<string, unknown> }[] };
          };
        }[];
      };
    };
    const detailedWhoami = whoami.output.anyOf.find((item) => item.properties?.balance);
    expect(detailedWhoami?.properties?.balance?.properties.available.anyOf).toContainEqual({
      type: "null",
    });
    expect(detailedWhoami?.properties?.key?.anyOf[0]?.properties).toHaveProperty("balance_error");

    const keys = JSON.parse(await walletCli(["keys", "list", "--schema", "--format", "json"])) as {
      output: {
        properties: {
          keys: { items: { properties: Record<string, unknown> } };
        };
      };
    };
    expect(keys.output.properties.keys.items.properties).toHaveProperty("balance_error");
  });

  it.each([
    ["long json", ["services", "--json-output", "--schema"]],
    ["short json", ["services", "-j", "--schema"]],
    ["prefix json", ["-j", "services", "--schema"]],
    ["boolean json", ["services", "--json-output", "true", "--schema"]],
    ["long toon with explicit json", ["services", "--toon-output", "--format", "json", "--schema"]],
    ["short toon with explicit json", ["services", "-t", "--format", "json", "--schema"]],
  ])("normalizes legacy services output aliases before schema dispatch: %s", async (_, args) => {
    const schema = JSON.parse(await walletCli(args)) as {
      args: { properties: { serviceId: { type: string } } };
    };
    expect(schema.args.properties.serviceId.type).toBe("string");
  });

  it("keeps explicit services --format precedence over quick output aliases", async () => {
    const output = await walletCli(["services", "--json-output", "--format", "json", "--schema"]);
    const schema = JSON.parse(output) as {
      options: { properties: { search: { type: string } } };
    };

    expect(schema.options.properties.search.type).toBe("string");

    const toon = await walletCli(["services", "--json-output", "--format", "toon", "--schema"]);
    expect(toon).toContain("args:");
    expect(toon).toContain("serviceId:");
  });

  it("includes built-in mcp and skills commands in --describe", async () => {
    const output = await walletCli(["--describe"]);
    const manifest = JSON.parse(output) as {
      subcommands: {
        aliases?: string[] | undefined;
        args?: { long?: string | undefined }[] | undefined;
        name: string;
        subcommands?: { aliases?: string[] | undefined; name: string }[] | undefined;
      }[];
    };

    const services = manifest.subcommands.find((command) => command.name === "services");
    expect(services?.subcommands).toBeUndefined();
    expect(services?.args?.map((arg) => arg.long)).toEqual([undefined, "--search", "--refresh"]);

    const keys = manifest.subcommands.find((command) => command.name === "keys");
    expect(keys?.subcommands?.map((command) => command.name)).toEqual(["list", "update"]);
    expect(manifest.subcommands.some((command) => command.name === "update-access-key")).toBe(
      false,
    );

    const mcp = manifest.subcommands.find((command) => command.name === "mcp");
    expect(mcp?.subcommands?.map((command) => command.name)).toEqual(["add"]);

    const skills = manifest.subcommands.find((command) => command.name === "skills");
    expect(skills?.aliases).toEqual(["skill"]);
    expect(skills?.subcommands?.map((command) => command.name)).toEqual(["add", "list"]);
    expect(skills?.subcommands?.find((command) => command.name === "list")?.aliases).toEqual([
      "ls",
    ]);
  });

  it("returns side-effect-free schema for built-in integration commands", async () => {
    const mcpAdd = JSON.parse(await walletCli(["mcp", "add", "--schema", "--format", "json"])) as {
      options: { properties: { agent: { description: string } } };
    };
    expect(mcpAdd.options.properties.agent.description).toContain("Target");

    const skillsAdd = JSON.parse(
      await walletCli(["skills", "add", "--schema", "--format", "json"]),
    ) as {
      options: { properties: { depth: { description: string } } };
    };
    expect(skillsAdd.options.properties.depth.description).toContain("Grouping depth");

    const skillsList = JSON.parse(
      await walletCli(["skills", "list", "--schema", "--format", "json"]),
    ) as {
      output: { items: { properties: { installed: { type: string } } } };
    };
    expect(skillsList.output.items.properties.installed.type).toBe("boolean");
  }, 30_000);

  it("accepts --no-browser for browser-backed wallet commands", () => {
    expect(Parser.parse(["--no-browser"], { options: loginOptions }).options).toMatchObject({
      browser: false,
    });
    expect(Parser.parse(["--no-browser"], { options: fundOptions }).options).toMatchObject({
      browser: false,
    });
    expect(
      Parser.parse(["--limit", "250", "--no-browser"], { options: updateAccessKeyOptions }).options,
    ).toMatchObject({ browser: false, limit: "250" });
  });

  it.each([
    [[], false],
    [["--amount", "17.43", "--timeout", "30"], false],
    [["--wait"], true],
    [["--no-wait"], false],
    [["--wait", "--no-wait"], false],
    [["--no-wait", "--wait"], true],
  ] as const)("parses funding waiting preference for %j", (args, wait) => {
    expect(Parser.parse([...args], { options: fundOptions }).options).toMatchObject({ wait });
  });

  it("returns strongly typed schema properties for sessions list output", async () => {
    const output = await walletCli(["sessions", "list", "--schema", "--format", "json"]);
    const schema = JSON.parse(output) as {
      output: {
        properties: {
          sessions: {
            items: {
              properties: {
                channel_id: { type: string };
                status: { type: string };
              };
            };
          };
        };
      };
    };
    expect(schema.output.properties.sessions.items.properties.channel_id.type).toBe("string");
    expect(schema.output.properties.sessions.items.properties.status.type).toBe("string");
  });
});

function hasNextStep(schema: unknown): boolean {
  const { anyOf, properties } = schema as {
    anyOf?: unknown[] | undefined;
    properties?: Record<string, { properties?: Record<string, unknown> }> | undefined;
  };
  if (properties?.instruction && properties._next?.properties?.argv) return true;
  return (anyOf ?? []).some(hasNextStep);
}

async function walletCli(args: string[]) {
  return bundledCli(cliBundle("wallet"), args);
}

async function requestCli(args: string[]) {
  return bundledCli(cliBundle("request"), args);
}

async function bundledCli(entrypoint: string, args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    version: string;
  };
  return packageJson.version;
}
