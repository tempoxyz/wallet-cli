import { EventEmitter } from "node:events";
import { platform } from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

import { canPrompt, openExternal, runProcess } from "../src/shared/process.js";
import { failedSpawn } from "./fixtures/failed-spawn.js";

afterEach(() => {
  mocks.spawn.mockReset();
  vi.unstubAllEnvs();
});

describe("canPrompt", () => {
  it.each([
    { agent: false, stdinTTY: true, expected: true },
    { agent: false, stdinTTY: undefined, expected: false },
    { agent: true, stdinTTY: true, expected: false },
    { agent: true, stdinTTY: undefined, expected: false },
  ])(
    "is $expected for agent $agent with stdin isTTY $stdinTTY",
    ({ agent, stdinTTY, expected }) => {
      const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      Object.defineProperty(process.stdin, "isTTY", { value: stdinTTY, configurable: true });
      try {
        expect(canPrompt(agent)).toBe(expected);
      } finally {
        if (original) Object.defineProperty(process.stdin, "isTTY", original);
        else delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
    },
  );
});

describe("openExternal", () => {
  it("ignores a missing browser opener on headless systems", () => {
    vi.stubEnv("TEMPO_NO_BROWSER", "");
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    mocks.spawn.mockReturnValue(child);

    openExternal("https://wallet.tempo.xyz/cli-auth");

    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    expect(mocks.spawn).toHaveBeenCalledWith(
      command,
      platform === "win32"
        ? ["/c", "start", "", "https://wallet.tempo.xyz/cli-auth"]
        : ["https://wallet.tempo.xyz/cli-auth"],
      { detached: true, stdio: "ignore" },
    );
    expect(child.unref).toHaveBeenCalledOnce();
    expect(() => child.emit("error", new Error(`spawn ${command} ENOENT`))).not.toThrow();
  });

  it.each(["1", "true"])("does not open a browser when TEMPO_NO_BROWSER=%s", (value) => {
    vi.stubEnv("TEMPO_NO_BROWSER", value);

    openExternal("https://wallet.tempo.xyz/cli-auth");

    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

// Node emits EAGAIN, EACCES, and ENOENT, emits EMFILE and ENFILE without setting up stdio, and
// throws ENOMEM and EPERM; see `failedSpawn`.
describe("runProcess when the command cannot start", () => {
  it.each([
    { code: "EAGAIN", retryable: true, message: "spawn sqlite3 EAGAIN" },
    { code: "EMFILE", retryable: true, message: "spawn sqlite3 EMFILE" },
    { code: "ENFILE", retryable: true, message: "spawn sqlite3 ENFILE" },
    { code: "ENOMEM", retryable: true, message: "spawn ENOMEM" },
    { code: "EACCES", retryable: false, message: "spawn sqlite3 EACCES" },
    { code: "EPERM", retryable: false, message: "spawn EPERM" },
  ])("rejects with E_RUNTIME on $code, retryable $retryable", async ({ code, ...error }) => {
    mocks.spawn.mockImplementation(() => failedSpawn(code));

    await expect(runProcess("sqlite3", [])).rejects.toMatchObject({
      code: "E_RUNTIME",
      exitCode: 1,
      ...error,
    });
  });

  it("keeps Node's ENOENT error for a missing command", async () => {
    mocks.spawn.mockImplementation(() => failedSpawn("ENOENT"));

    await expect(runProcess("sqlite3", [])).rejects.toMatchObject({
      code: "ENOENT",
      message: "spawn sqlite3 ENOENT",
    });
  });
});
