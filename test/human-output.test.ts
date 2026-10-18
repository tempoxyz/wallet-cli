import { execFile } from "node:child_process";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { humanRun } from "../src/cli/incur-compat.js";
import { cliBundle } from "./cli-bundle.js";
import { testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";

const wallet = testWallet.toLowerCase();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("humanRun", () => {
  it.each([
    { argv: ["whoami"], human: true },
    { argv: ["-n", "testnet", "keys", "list"], human: true },
    { argv: ["--network=testnet", "balance"], human: true },
    // An unknown command's error is rendered for a person too.
    { argv: ["nope"], human: true },
    { argv: ["whoami"], terminal: false, human: false },
    { argv: [], human: false },
    { argv: ["skills", "list"], human: false },
    { argv: ["mcp", "add"], human: false },
    ...[
      ["--format", "json"],
      ["--format", "toon"],
      ["--json"],
      ["-j"],
      ["-t"],
      ["-sj"],
      ["--json-output"],
      ["--toon-output=true"],
      ["--full-output"],
      ["--filter-output", "network"],
      ["--token-count"],
      ["--token-limit", "10"],
      ["--schema"],
      ["--llms"],
      ["--llms-full"],
      ["--help"],
      ["-h"],
      ["--version"],
      ["--mcp"],
    ].map((flags) => ({ argv: ["whoami", ...flags], human: false })),
  ])(
    "$argv on a terminal ($terminal) is a person's run: $human",
    ({ argv, terminal = true, human }) => {
      expect(humanRun(argv, terminal)).toBe(human);
    },
  );

  it("leaves shell completion to incur", () => {
    vi.stubEnv("COMPLETE", "zsh");
    expect(humanRun(["whoami"], true)).toBe(false);
  });
});

describe("tempo wallet on a terminal", () => {
  it.each([
    {
      name: "address prints a block on stdout",
      argv: ["address"],
      code: 0,
      stdout: `Address   ${wallet}\nChain ID  4217\nNetwork   tempo\n`,
      stderr: "",
    },
    {
      name: "config get prints nested settings",
      argv: ["config", "get", "network"],
      code: 0,
      stdout: "Network\n  Value   mainnet\n  Source  login\n",
      stderr: "",
    },
    {
      name: "a command error prints on stderr with its fix and keeps its exit code",
      argv: ["balance"],
      state: walletState({ accounts: [], accessKeys: [] }),
      code: 4,
      stdout: "",
      stderr:
        "Error: No wallet is logged in. Run 'tempo wallet login --network mainnet' before retrying.\nNext: tempo wallet login --network mainnet\n",
    },
    {
      name: "an unknown command prints on stderr",
      argv: ["nope"],
      code: 1,
      stdout: "",
      stderr:
        "Error: 'nope' is not a command for 'tempo wallet'.\nNext: tempo wallet --help  # see all available commands\n",
    },
    {
      name: "a usage error prints incur's usage on stderr",
      argv: ["send", "1"],
      code: 1,
      stdout: "",
      stderr: expect.stringMatching(
        /^Error: missing required argument <token>\n[\s\S]*Usage: tempo wallet send <amount> <token> <to>/,
      ),
    },
  ])("$name", async ({ name: _, argv, state = walletState(), ...expected }) => {
    const home = await useTempHome();
    await writeWalletState(state);

    expect(await run(argv, home, { terminal: true })).toEqual(expected);
  });

  // Anyone asking for a format gets what an agent gets, as before human rendering.
  it.each([
    ["address", "--format", "json"],
    ["address", "--format", "toon"],
    ["address", "--json"],
    ["address", "-j"],
    ["address", "-t"],
    ["config", "get", "--format", "yaml"],
    ["balance", "--format", "json"],
    ["nope", "--format", "json"],
  ])("%s on a terminal prints what a piped run does", async (...argv) => {
    const home = await useTempHome();
    await writeWalletState(walletState(argv[0] === "balance" ? { accounts: [] } : {}));

    const piped = await run(argv, home, { terminal: false });
    expect(await run(argv, home, { terminal: true })).toEqual(piped);
  });
});

/** Runs the wallet CLI with stdout a terminal on request, without colors. */
function run(argv: string[], home: string, { terminal }: { terminal: boolean }) {
  const fixture = join(import.meta.dirname, "fixtures", "interactive-stdout.mjs");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NO_COLOR: "1" };
  delete env.TEMPO_WALLET_NETWORK;
  delete env.TEMPO_PRIVATE_KEY;
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [...(terminal ? ["--import", fixture] : []), cliBundle("wallet"), ...argv],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
