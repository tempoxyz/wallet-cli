import { Cli } from "incur";
import { afterEach, describe, expect, it, vi } from "vitest";

import { retireFlags, type RetiredFlag } from "../src/cli/argv.js";
import type { WalletCommand } from "../src/cli/command.js";
import { commands } from "../src/cli/commands.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const renamed: RetiredFlag = {
  flag: "--old",
  takesValue: true,
  replacement: ({ args, value }) => ({
    message: "--old was removed; pass --new",
    argv: ["demo", ...args, "--new", value ?? "<value>"],
  }),
};
const dropped: RetiredFlag = {
  flag: "--gone",
  replacement: () => ({ message: "--gone was removed" }),
};
const moved: RetiredFlag = {
  flag: "--mode",
  replacement: ({ given }) => ({ message: "--mode moved to other", argv: ["other", ...given] }),
};
const demo: WalletCommand[] = [
  { command: Cli.create("demo", { run: () => ({}) }), retiredFlags: [renamed, dropped, moved] },
  { command: Cli.create("other", { run: () => ({}) }) },
];
const usage = { code: "E_USAGE", exitCode: 2, retryable: false };
const cta = (command: string) => ({ cta: { commands: [{ command }] } });

describe("retireFlags", () => {
  it.each([
    { name: "no command", args: ["--help"] },
    { name: "a command without retired flags", args: ["other", "--old", "x"] },
    { name: "no retired flag", args: ["demo", "a", "--new", "x"] },
    { name: "a retired flag after --", args: ["demo", "--", "--old", "x"] },
    { name: "a retired flag before the command", args: ["--gone", "demo"] },
  ])("leaves argv with $name unchanged", ({ args }) => {
    expect(retireFlags(args, demo)).toEqual({ args });
  });

  it.each([
    {
      name: "a value that reads as a flag, with no cta",
      args: ["demo", "a", "--old", "--mcp"],
      stripped: ["demo", "a"],
      error: { message: "--old was removed; pass --new" },
    },
    {
      name: "a flag and its value",
      args: ["demo", "a", "--old", "x", "--yes"],
      stripped: ["demo", "a", "--yes"],
      error: {
        message: "--old was removed; pass --new",
        ...cta("tempo wallet demo a --yes --new x"),
      },
    },
    {
      name: "a bound value",
      args: ["demo", "--old=x y", "a"],
      stripped: ["demo", "a"],
      error: {
        message: "--old was removed; pass --new",
        ...cta("tempo wallet demo a --new 'x y'"),
      },
    },
    {
      name: "a flag missing its value",
      args: ["demo", "a", "--old"],
      stripped: ["demo", "a"],
      error: {
        message: "--old was removed; pass --new",
        ...cta("tempo wallet demo a --new '<value>'"),
      },
    },
    {
      name: "the tokens before the command, kept in the cta",
      args: ["--network=testnet", "demo", "--old", "x"],
      stripped: ["--network=testnet", "demo"],
      error: {
        message: "--old was removed; pass --new",
        ...cta("tempo wallet --network=testnet demo --new x"),
      },
    },
    {
      name: "a flag with no replacement command",
      args: ["demo", "--gone", "a"],
      stripped: ["demo", "a"],
      error: { message: "--gone was removed" },
    },
    {
      name: "every retired flag, reporting the first",
      args: ["demo", "--gone", "--old", "x", "a"],
      stripped: ["demo", "a"],
      error: { message: "--gone was removed" },
    },
    {
      name: "a retired flag before --, leaving the operands after it",
      args: ["demo", "--gone", "--", "--old"],
      stripped: ["demo", "--", "--old"],
      error: { message: "--gone was removed" },
    },
  ])("strips $name and returns its usage error", ({ args, stripped, error }) => {
    expect(retireFlags(args, demo)).toEqual({ args: stripped, error: { ...usage, ...error } });
  });

  it.each([
    ["demo", "--gone=false", "a"],
    ["demo", "--gone", "false", "a"],
    ["demo", "--no-gone", "a"],
    ["demo", "a", "--no-mode", "--mode=false"],
  ])("strips an explicit false in %j without an error", (...args) => {
    expect(retireFlags(args, demo)).toEqual({ args: ["demo", "a"] });
  });

  it.each([
    ["demo", "--gone=true", "a"],
    ["demo", "--gone", "true", "a"],
  ])("refuses an explicit true in %j", (...args) => {
    expect(retireFlags(args, demo)).toEqual({
      args: ["demo", "a"],
      error: { ...usage, message: "--gone was removed" },
    });
  });

  it.each([
    ["a", "--mode", "--yes"],
    ["a", "--mode=true", "--yes"],
    ["a", "--mode", "true", "--yes"],
  ])("keeps the flags of %j as given in the cta", (...given) => {
    expect(retireFlags(["demo", ...given], demo)).toEqual({
      args: ["demo", "a", "--yes"],
      error: {
        ...usage,
        message: "--mode moved to other",
        ...cta(`tempo wallet other ${given.join(" ")}`),
      },
    });
  });

  it("leaves argv unchanged during shell completion", () => {
    vi.stubEnv("COMPLETE", "zsh");
    expect(retireFlags(["demo", "--gone"], demo)).toEqual({ args: ["demo", "--gone"] });
  });

  it.each([
    {
      flag: "--mach",
      message:
        "'send' sends tokens only; to pay an MPP challenge with MACH, use 'tempo wallet transfer --mach'.",
    },
    {
      flag: "--credits",
      message:
        "'send' sends tokens only; to spend legacy MPP Credits, use 'tempo wallet transfer --credits'.",
    },
  ])("points send $flag at transfer $flag", ({ flag, message }) => {
    expect(retireFlags(["send", flag, "--dry-run", "-n", "testnet"], commands)).toEqual({
      args: ["send", "--dry-run", "-n", "testnet"],
      error: { ...usage, message, ...cta(`tempo wallet transfer ${flag} --dry-run -n testnet`) },
    });
  });

  it.each([
    ["--mach=false"],
    ["--mach", "false"],
    ["--no-mach"],
    ["--credits=false"],
    ["--credits", "false"],
    ["--no-credits"],
  ])("runs send %j as a token send", (...flag) => {
    expect(retireFlags(["send", "1", "USDC.e", "0xabc", ...flag, "--yes"], commands)).toEqual({
      args: ["send", "1", "USDC.e", "0xabc", "--yes"],
    });
  });

  it.each([
    // `--credits` keeps its recipient, calldata, and amount.
    ["transfer", "--credits", "--to=0xabc", "--data=0x12", "--amount-cents=100"],
    ["transfer", "--amount-cents=100", "--to=0xabc", "--credits=true"],
    // MACH refuses these itself, naming its own replacements.
    ["transfer", "--mach", "--to=0xabc", "--data=0x12"],
    // A group's retired flags are its own command's, not its subcommands'.
    ["fund", "status", "--claim", "CODE"],
  ])("leaves %j to the command", (...args) => {
    expect(retireFlags(args, commands)).toEqual({ args });
  });

  // An explicit false selects no mode, so the run is a token transfer.
  it.each([["--credits=false"], ["--mach", "false"]])(
    "refuses a token transfer's --to with %j",
    (...mode) => {
      expect(retireFlags(["transfer", "1", "USDC.e", "--to", "0xabc", ...mode], commands)).toEqual({
        args: ["transfer", "1", "USDC.e", ...mode],
        error: {
          ...usage,
          message:
            "--to sets the MPP Credits recipient of 'tempo wallet transfer --credits'; pass a token transfer's recipient as the third argument: 'tempo wallet send <amount> <token> <to>'.",
          ...cta(`tempo wallet send 1 USDC.e 0xabc ${mode.join(" ")}`),
        },
      });
    },
  );

  // `--amount-cents` is the MACH cap only with `--mach`, and a token amount otherwise.
  it.each([
    {
      args: ["transfer", "--mach", "--amount-cents=2"],
      message:
        "--amount-cents was removed from --mach; pass the spending cap in USD with --max-spend.",
      command: "tempo wallet transfer --mach --max-spend 0.02",
    },
    {
      args: ["transfer", "1", "USDC.e", "0xabc", "--amount-cents=2", "--mach=false"],
      message:
        "--amount-cents sets the MPP Credits amount of 'tempo wallet transfer --credits'; pass a token transfer's amount in token units as the first argument: 'tempo wallet send <amount> <token> <to>'.",
      command: undefined,
    },
  ])("refuses $args with the replacement for its mode", ({ args, message, command }) => {
    expect(retireFlags(args, commands)).toEqual({
      args: args.filter((arg) => arg !== "--amount-cents=2"),
      error: { ...usage, message, ...(command ? cta(command) : {}) },
    });
  });

  it("leaves transfer --mach and --credits to transfer", () => {
    for (const flag of ["--mach", "--credits"])
      expect(retireFlags(["transfer", flag], commands)).toEqual({ args: ["transfer", flag] });
  });
});
