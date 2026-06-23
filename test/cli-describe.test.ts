import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { Parser } from "incur";
import { describe, expect, it } from "vitest";

import { fundOptions, loginOptions } from "../src/schemas.js";

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
    expect(output).not.toContain("Usage: tempo wallet services <command>");
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
        name: string;
        subcommands?: { aliases?: string[] | undefined; name: string }[] | undefined;
      }[];
    };

    const services = manifest.subcommands.find((command) => command.name === "services");
    expect(services?.subcommands).toBeUndefined();

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
  });

  it("accepts --no-browser for browser-backed wallet commands", () => {
    expect(Parser.parse(["--no-browser"], { options: loginOptions }).options).toMatchObject({
      browser: false,
    });
    expect(Parser.parse(["--no-browser"], { options: fundOptions }).options).toMatchObject({
      browser: false,
    });
  });
});

async function walletCli(args: string[]) {
  return tsxCli("src/cli.ts", args);
}

async function requestCli(args: string[]) {
  return tsxCli("src/request-cli.ts", args);
}

async function tsxCli(entrypoint: string, args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", entrypoint, ...args],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout;
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    version: string;
  };
  return packageJson.version;
}
