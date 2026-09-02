import { EventEmitter } from "node:events";
import { platform } from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

import { openExternal } from "../src/shared/process.js";

afterEach(() => {
  mocks.spawn.mockReset();
});

describe("openExternal", () => {
  it("ignores a missing browser opener on headless systems", () => {
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
});
