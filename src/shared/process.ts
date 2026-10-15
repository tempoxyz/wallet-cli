import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, platform } from "node:process";
import { createInterface } from "node:readline/promises";

/** Opens `url` in the default browser, unless `TEMPO_NO_BROWSER` is set (headless hosts, agents). */
export function openExternal(url: string) {
  if (env.TEMPO_NO_BROWSER) return;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  // Spawning emits an asynchronous error when no browser opener is installed
  // (common on headless VMs). The URL is printed before this best-effort call,
  // so keep the CLI alive and let the user open it elsewhere.
  child.on("error", () => undefined);
  child.unref();
}

/** Asks a yes/no question on stderr. Only `y` or `yes` confirms; input that ends declines. */
export async function confirm(question: string) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const closed = new Promise<string>((resolve) => prompt.once("close", () => resolve("")));
  try {
    const answer = await Promise.race([prompt.question(`${question} [y/N] `), closed]);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

export function runProcess(command: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

export async function runSql(sql: string) {
  await runProcess("sqlite3", [channelsDbPath(), sql]);
}

export function channelsDbPath() {
  return join(homedir(), ".tempo", "wallet", "channels.db");
}

export function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
