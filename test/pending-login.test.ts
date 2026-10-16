import { setTimeout as sleep } from "node:timers/promises";

import { expect, it, vi } from "vitest";

import {
  clearPendingLogin,
  loadPendingLogin,
  savePendingLogin,
  type PendingLogin,
} from "../src/wallet/store.js";
import { useTempHome } from "./helpers.js";

const { onRead } = vi.hoisted(() => ({
  onRead: { run: undefined as (() => Promise<void>) | undefined },
}));

// Runs `onRead.run` once, right after the next read of the pending login, before the reader sees it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = async (...args: Parameters<typeof actual.readFile>) => {
    const contents = await actual.readFile(...args);
    const run = onRead.run;
    if (run && String(args[0]).endsWith("pending-login.json")) {
      onRead.run = undefined;
      await run();
    }
    return contents;
  };
  return { ...actual, readFile };
});

function pendingLogin(deviceCode: string): PendingLogin {
  return {
    network: "mainnet",
    registration: {
      device_code: deviceCode,
      user_code: "ABCDEFGH",
      verification_uri: "https://wallet.tempo.xyz/device",
    },
    codeVerifier: "verifier",
    accessKey: { handle: { kind: "p256" }, publicKey: "0x04" },
    expiresAt: 2_000_000_000,
  };
}

it.each([
  { name: "removes the login it was asked to clear", newer: false, left: undefined },
  {
    name: "leaves a newer login saved after it checked the older one",
    newer: true,
    left: "device-new",
  },
])("$name", async ({ newer, left }) => {
  await useTempHome();
  await savePendingLogin(pendingLogin("device-old"));
  let saving: Promise<void> | undefined;
  // Another login saves its pending login once this clear has read the older one, with up to
  // 200 ms to finish before the clear goes on.
  if (newer)
    onRead.run = async () => {
      saving = savePendingLogin(pendingLogin("device-new"));
      await Promise.race([saving, sleep(200)]);
    };

  await clearPendingLogin("device-old");
  await saving;

  expect((await loadPendingLogin())?.registration.device_code).toBe(left);
});
