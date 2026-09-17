import { describe, expect, it, vi } from "vitest";

import { handleCompatCommand } from "../src/compat.js";
import { useTempHome, testWallet, walletState, writeWalletState } from "./helpers.js";

describe("handleCompatCommand", () => {
  it("prints the resolved whoami payload for login --no-browser", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const handled = await handleCompatCommand(["login", "--no-browser", "--json-output"]);

    expect(handled).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);

    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(printed.wallet).toBe(testWallet.toLowerCase());
    expect(printed).toHaveProperty("balance");
    expect(printed).toHaveProperty("key");
  });
});
