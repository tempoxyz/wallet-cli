import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cli, z } from "incur";
import { afterEach, describe, expect, it } from "vitest";

import { docBlocks, renderBlocks, replaceBlocks, updateDocs } from "../scripts/docs.js";
import { destructive, readOnly, type WalletCommand } from "../src/cli/command.js";
import { flag, option } from "../src/cli/describe.js";
import { globalAlias, globalOptionShape } from "../src/schemas/shared.js";

const start = (name: string) => `<!-- generated:${name} start -->`;
const end = (name: string) => `<!-- generated:${name} end -->`;

const fixture: WalletCommand[] = [
  {
    command: Cli.create("pay", {
      description: "Pay an address",
      args: z.object({ to: z.string(), memo: z.string().optional() }),
      options: z.object({
        ...globalOptionShape,
        browser: z.boolean().default(true),
        "dry-run": z.boolean().optional(),
        maxSpend: z.string().optional(),
      }),
      alias: { ...globalAlias, "dry-run": "d" },
      run: () => ({}),
    }).command("status", {
      description: "Show a payment.",
      args: z.object({ format: z.enum(["short", "long"]).optional() }),
      options: z.object(globalOptionShape),
      run: () => ({}),
    }),
    annotations: {
      pay: { ...destructive, idempotentHint: false, openWorldHint: true },
      pay_status: { ...readOnly, openWorldHint: false },
    },
  },
  {
    describe: {
      name: "mcp",
      about: "Register as MCP server",
      subcommands: [
        {
          name: "add",
          about: "Register as MCP server",
          args: [
            option("command", "--command", "Command", { short: "-c" }),
            flag("no_global", "--no-global", "Project"),
          ],
        },
      ],
    },
  },
];

describe("renderBlocks", () => {
  it("lists each command with its usage, description, and options, then the global options", () => {
    expect(renderBlocks(fixture).commands).toBe(
      [
        "- `pay <to> [memo]`: Pay an address. Options: `--no-browser`, `--dry-run` (`-d`), `--max-spend`.",
        "- `pay status [short|long]`: Show a payment.",
        "- `mcp add`: Register as MCP server. Options: `--command` (`-c`), `--no-global`.",
        "",
        "Global options: `--network` (`-n`), `--verbose` (`-v`), `--silent` (`-s`), `--json-output` (`-j`), and `--toon-output` (`-t`).",
      ].join("\n"),
    );
  });

  it("tabulates each MCP tool's annotation hints, padded as the formatter pads them", () => {
    expect(renderBlocks(fixture)["mcp-tools"]).toBe(
      [
        "| Tool         | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |",
        "| ------------ | -------------- | ----------------- | ---------------- | --------------- |",
        "| `pay`        | false          | true              | false            | true            |",
        "| `pay_status` | true           | false             | true             | false           |",
      ].join("\n"),
    );
  });

  it("refuses a tool without annotations", () => {
    const [pay] = fixture;
    expect(() => renderBlocks([{ command: pay!.command }])).toThrow(
      "MCP tool pay declares no readOnlyHint",
    );
  });

  it("renders the same blocks on every run, with LF line endings and no trailing spaces", () => {
    const blocks = renderBlocks();

    expect(renderBlocks()).toEqual(blocks);
    for (const content of Object.values(blocks)) {
      expect(content).not.toMatch(/\r|[ \t]$/m);
      expect(content).toBe(content.trim());
    }
  });
});

describe("replaceBlocks", () => {
  it("replaces only the text between each block's markers", () => {
    const before = "# Title\n\nHand-written  \n\n";
    const between = "\n\nMore prose.\n";
    const after = "\n\nThe end.\n";
    const text = `${before}${start("one")}\nstale\n\nlines\n${end("one")}${between}${start("two")}\n${end("two")}${after}`;

    expect(replaceBlocks(text, { one: "- fresh", two: "| table |" })).toBe(
      `${before}${start("one")}\n\n- fresh\n\n${end("one")}${between}${start("two")}\n\n| table |\n\n${end("two")}${after}`,
    );
  });

  it("leaves current blocks unchanged", () => {
    const text = replaceBlocks(`a\n${start("one")}\n${end("one")}\nb\n`, { one: "- item" });

    expect(replaceBlocks(text, { one: "- item" })).toBe(text);
  });

  it.each([
    { name: "an unknown block", text: `${start("other")}\n${end("other")}`, error: "Unknown" },
    { name: "a missing block", text: "no markers", error: "Missing generated blocks: one" },
    { name: "an unclosed block", text: `${start("one")}\n`, error: "has no end marker" },
    { name: "an unopened end marker", text: `${end("one")}\n`, error: "has no start marker" },
    {
      name: "a nested start marker",
      text: `${start("one")}\n${start("one")}\n${end("one")}`,
      error: "has no end marker",
    },
    {
      name: "a repeated block",
      text: `${start("one")}\n${end("one")}\n${start("one")}\n${end("one")}`,
      error: "appears more than once",
    },
  ])("rejects $name", ({ text, error }) => {
    expect(() => replaceBlocks(text, { one: "- item" })).toThrow(error);
  });
});

describe("updateDocs", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { force: true, recursive: true });
    root = undefined;
  });

  it("reports stale files in check mode without writing them, and generate makes them current", async () => {
    root = await mkdtemp(join(tmpdir(), "wallet-cli-docs-"));
    const stale = Object.fromEntries(
      Object.entries(docBlocks).map(([file, names]) => [
        file,
        `# ${file}\n\n${names.map((name) => `${start(name)}\n- stale\n${end(name)}\n`).join("\n")}`,
      ]),
    );
    for (const [file, text] of Object.entries(stale)) await writeFile(join(root, file), text);
    const files = Object.keys(docBlocks);

    expect(updateDocs(root, { check: true })).toEqual(files);
    for (const file of files) expect(await readFile(join(root, file), "utf8")).toBe(stale[file]);

    expect(updateDocs(root, { check: false })).toEqual(files);
    expect(updateDocs(root, { check: true })).toEqual([]);
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain(`${start("commands")}\n\n${renderBlocks().commands}\n\n`);
    expect(readme).not.toContain("- stale");
  });
});
