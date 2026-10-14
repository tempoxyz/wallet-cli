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
        "Register-ArgumentCompleter -Native -CommandName tempo",
        ...topLevel.map((name) => `        '${name}' = '`),
      ],
    },
    {
      shell: "elvish",
      expected: [
        "set edit:completion:arg-completer[tempo]",
        ...topLevel.map((name) => `edit:complex-candidate '${name}' &display='${name}  `),
      ],
    },
  ])("prints the $shell script hooked to `tempo wallet`", async ({ shell, expected }) => {
    const script = await wallet(["completions", shell]);

    for (const line of expected) expect(script).toContain(line);
    expect(await wallet(["-n", "testnet", "completions", shell])).toBe(script);
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

    const cases = [
      { words: ["tempo", "wallet", "sw"], expected: ["swap"] },
      { words: ["tempo", "wallet", "sessions", ""], expected: ["list", "close", "sync"] },
      { words: ["tempo", "wallet", "-n", "testnet", "fu"], expected: ["fund"] },
      { words: ["tempo", "node", ""], expected: [] },
    ];

    it.each(cases)("bash completes $words", async ({ words, expected }) => {
      const hook = await wallet(["completions", "bash"]);
      const script = `${hook}
COMP_WORDS=(${words.map((word) => `'${word}'`).join(" ")})
COMP_CWORD=${words.length - 1}
_tempo_wallet
printf '%s\\n' "\${COMPREPLY[@]}"`;

      expect(await shell("bash", script, bin)).toEqual(expected);
    });

    it.skipIf(!hasShell("zsh")).each(cases)("zsh completes $words", async ({ words, expected }) => {
      const hook = await wallet(["completions", "zsh"]);
      // Stub the completion system: capture what the hook hands to _describe.
      const script = `compdef() { :; }
_describe() { print -rl -- "\${(@P)2%%:*}"; }
${hook}
words=(${words.map((word) => `'${word}'`).join(" ")})
CURRENT=${words.length}
_tempo_wallet || true`;

      expect(await shell("zsh", script, bin)).toEqual(expected);
    });
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
