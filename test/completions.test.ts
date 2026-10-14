import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";

const execFileAsync = promisify(execFile);

const topLevel = [
  "login",
  "refresh",
  "logout",
  "whoami",
  "keys",
  "revoke",
  "transfer",
  "swap",
  "fund",
  "sessions",
  "services",
  "debug",
  "completions",
  "mcp",
  "skills",
  "help",
  "--network",
  "-n",
  "--filter-output",
  "--format",
  "--full-output",
  "--help",
  "--llms",
  "--llms-full",
  "--mcp",
  "--schema",
  "--token-count",
  "--token-limit",
  "--token-offset",
  "--version",
];

describe("tempo wallet completions", () => {
  it("lists every supported shell", async () => {
    expect(await wallet(["completions"])).toBe(
      "Supported shells: bash, zsh, fish, nushell, powershell, elvish\n",
    );
  });

  it.each([
    { shell: "bash", expected: ["complete -o default -o bashdefault -F _tempo_wallet tempo"] },
    { shell: "zsh", expected: ["compdef _tempo_wallet tempo"] },
    { shell: "fish", expected: ["COMPLETE=fish tempo wallet --"] },
    { shell: "nushell", expected: ["COMPLETE=nushell tempo wallet --"] },
    {
      shell: "powershell",
      expected: [
        "# Replaces any other native completer for tempo",
        "Register-ArgumentCompleter -Native -CommandName tempo",
        ...topLevel.map((name) => `        '${name}' = '`),
      ],
    },
    {
      shell: "elvish",
      expected: [
        "set tempo-wallet-previous = $edit:completion:arg-completer[tempo]",
        "set edit:completion:arg-completer[tempo]",
        "$tempo-wallet-previous $@words",
        ...topLevel.map((name) => `edit:complex-candidate '${name}' &display='${name}  `),
      ],
    },
  ])("prints the $shell script hooked to `tempo wallet`", async ({ shell, expected }) => {
    const script = await wallet(["completions", shell]);

    for (const line of expected) expect(script).toContain(line);
  });

  it.each([
    [["completions", "-n", "testnet", "bash"], "bash"],
    [["completions", "bash", "-n", "testnet"], "bash"],
    [["-n", "testnet", "completions", "bash"], "bash"],
    [["completions", "--format", "json", "zsh"], "zsh"],
  ])("%j prints the %s script", async (args, shell) => {
    expect(await wallet(args)).toBe(await wallet(["completions", shell]));
  });

  describe("shell hooks", () => {
    let bin: string;

    beforeAll(async () => {
      // Stands in for the launcher, which runs `tempo wallet ...` as `tempo-wallet ...`.
      bin = await mkdtemp(join(tmpdir(), "wallet-cli-completions-"));
      await writeFile(
        join(bin, "tempo"),
        `#!/bin/sh\nshift\nexec "${process.execPath}" "${cliBundle("wallet")}" "$@"\n`,
      );
      await chmod(join(bin, "tempo"), 0o755);
    });

    afterAll(() => rm(bin, { force: true, recursive: true }));

    // `previous` registers another `tempo` completer first; the hook must delegate to it.
    const cases = [
      { words: ["tempo", "wallet", "sw"], previous: false, expected: ["swap"] },
      {
        words: ["tempo", "wallet", "sessions", ""],
        previous: false,
        expected: ["list", "close", "sync"],
      },
      { words: ["tempo", "wallet", "-n", "testnet", "fu"], previous: false, expected: ["fund"] },
      { words: ["tempo", "node", ""], previous: false, expected: [] },
      { words: ["tempo", "wallet", "sw"], previous: true, expected: ["swap"] },
      { words: ["tempo", "request", ""], previous: true, expected: ["from-previous"] },
      { words: ["tempo", "wal"], previous: true, expected: ["from-previous"] },
    ];

    // Each script sources the hook twice: re-sourcing must keep delegating, not recurse.
    it.each(cases)(
      "bash completes $words (previous: $previous)",
      async ({ words, previous, expected }) => {
        const hook = await wallet(["completions", "bash"]);
        const script = `${previous ? "_tempo_previous() { COMPREPLY=(from-previous); }\ncomplete -F _tempo_previous tempo" : ""}
${hook}
${hook}
COMP_WORDS=(${words.map((word) => `'${word}'`).join(" ")})
COMP_CWORD=${words.length - 1}
_tempo_wallet
printf '%s\\n' "\${COMPREPLY[@]}"`;

        expect(await shell("bash", script, bin)).toEqual(expected);
      },
    );

    it.skipIf(!hasShell("zsh")).each(cases)(
      "zsh completes $words (previous: $previous)",
      async ({ words, previous, expected }) => {
        const hook = await wallet(["completions", "zsh"]);
        // Stub the completion system: record compdef in _comps and print what reaches _describe.
        const script = `typeset -A _comps
compdef() { _comps[$2]=$1; }
_describe() { print -rl -- "\${(@P)2%%:*}"; }
${previous ? "_tempo_previous() { print -r -- from-previous; }\n_comps[tempo]=_tempo_previous" : ""}
${hook}
${hook}
words=(${words.map((word) => `'${word}'`).join(" ")})
CURRENT=${words.length}
_tempo_wallet || true`;

        expect(await shell("zsh", script, bin)).toEqual(expected);
      },
    );
  });
});

async function wallet(args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [cliBundle("wallet"), ...args], {
    env: { ...process.env, NO_COLOR: "1" },
  });
  return stdout;
}

async function shell(name: string, script: string, bin: string) {
  const { stdout } = await execFileAsync(name, ["-c", script], {
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  return stdout.split("\n").filter(Boolean);
}

function hasShell(name: string) {
  return spawnSync(name, ["-c", "true"]).status === 0;
}
