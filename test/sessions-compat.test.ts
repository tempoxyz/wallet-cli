import { describe, expect, it, vi } from "vitest";

import { dryRunCloseSessions, listSessions } from "../src/commands/sessions.js";
import { handleCompatCommand } from "../src/compat.js";

import { expectUsageError, useTempHome } from "./helpers.js";

const validChannelId = `0x${"a".repeat(64)}`;

describe("sessions utilities", () => {
  it("lists no sessions when the local channel store is empty", async () => {
    await useTempHome();

    expect(await listSessions()).toEqual({ sessions: [], total: 0 });
  });

  it("rejects a dry-run close with no target via E_USAGE", async () => {
    await useTempHome();

    await expect(dryRunCloseSessions({})).rejects.toMatchObject({ code: "E_USAGE" });
    await dryRunCloseSessions({}).catch((error) =>
      expectUsageError(
        error,
        "Specify a URL, channel ID (0x...), or use --all/--orphaned/--finalize to close sessions",
      ),
    );
  });

  it("returns a bare channel target for a dry-run close of an unknown channel id", async () => {
    await useTempHome();

    expect(await dryRunCloseSessions({ target: validChannelId })).toEqual({
      targets: [{ channel_id: validChannelId }],
    });
  });

  it("rejects cooperative combined with --all/--orphaned/--finalize via E_USAGE", async () => {
    await useTempHome();

    const message = "--cooperative cannot be combined with --all, --orphaned, or --finalize";
    for (const combo of [
      { cooperative: true, all: true },
      { cooperative: true, orphaned: true },
      { cooperative: true, finalize: true },
    ]) {
      await dryRunCloseSessions(combo).then(
        () => {
          throw new Error("expected dryRunCloseSessions to throw");
        },
        (error) => expectUsageError(error, message),
      );
    }
  });
});

describe("compat completions", () => {
  it("lists supported shells when no shell is provided", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions"])).toBe(true);
    expect(log).toHaveBeenCalledWith("Supported shells: bash, zsh, fish, powershell, elvish");
  });

  it("prints a powershell completion script", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions", "powershell"])).toBe(true);
    const output = log.mock.calls[0]?.[0] as string;
    expect(output).toContain("Register-ArgumentCompleter");
    expect(output).toContain("CommandName 'tempo wallet'");
  });

  it("prints an elvish completion script", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions", "elvish"])).toBe(true);
    const output = log.mock.calls[0]?.[0] as string;
    expect(output).toContain("edit:completion:arg-completer[tempo wallet]");
    expect(output).toContain("cand login");
  });
});
