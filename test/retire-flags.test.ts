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
const demo: WalletCommand[] = [
  { command: Cli.create("demo", { run: () => ({}) }), retiredFlags: [renamed, dropped] },
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

  it("leaves transfer --mach and --credits to transfer", () => {
    for (const flag of ["--mach", "--credits"])
      expect(retireFlags(["transfer", flag], commands)).toEqual({ args: ["transfer", flag] });
  });
});
