import { readFile, rm, stat, writeFile } from "node:fs/promises";

import { Storage } from "accounts/cli";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { keysHandler } from "../src/commands/keys.js";
import { logoutHandler } from "../src/commands/logout.js";
import {
  ensureRemotePayer,
  loadRemotePayer,
  remotePayersPath,
} from "../src/wallet/remote-payer.js";
import { loadWalletState, saveWalletState, walletStorePath } from "../src/wallet/store.js";
import { runContext, testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";

const legacyKey = `0x${"4b".repeat(32)}` as const;

async function storeFile() {
  return JSON.parse(await readFile(walletStorePath(), "utf8")) as Record<string, any>;
}

beforeEach(async () => {
  await useTempHome();
  await writeWalletState(walletState());
});

describe("remote payer storage", () => {
  it("is created by the wallet's secp256k1 keystore and kept in the wallet store", async () => {
    const payer = await ensureRemotePayer(testWallet);

    const item = (await storeFile())["tempo-cli.remotePayers"];
    const entry = item.payers[testWallet.toLowerCase()];
    expect(item.version).toBe(1);
    expect(entry).toMatchObject({
      address: payer.address,
      keyType: "secp256k1",
      handle: { kind: "secp256k1", privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/i) },
    });
    expect(privateKeyToAccount(entry.handle.privateKey).address).toBe(payer.address);
    expect((await stat(walletStorePath())).mode & 0o777).toBe(0o600);
    // The SDK's own state is untouched.
    expect(await loadWalletState()).toMatchObject({ accounts: [{ address: testWallet }] });
  });

  it("keeps a write-once backup readable only by the owner", async () => {
    const payer = await ensureRemotePayer(testWallet);

    const backup = JSON.parse(await readFile(remotePayersPath(), "utf8"));
    expect(backup.payers[testWallet.toLowerCase()].address).toBe(payer.address);
    expect((await stat(remotePayersPath())).mode & 0o777).toBe(0o600);
  });

  it("survives the CLI rewriting the wallet store", async () => {
    const payer = await ensureRemotePayer(testWallet);

    await saveWalletState(walletState({ chainId: 42431 }));
    await saveWalletState(await loadWalletState());

    expect((await storeFile())["tempo-cli.remotePayers"].payers).toHaveProperty(
      testWallet.toLowerCase(),
    );
    expect((await loadRemotePayer(testWallet))?.address).toBe(payer.address);
  });

  it("survives the accounts SDK rewriting its store item", async () => {
    const payer = await ensureRemotePayer(testWallet);
    const sdk = Storage.filesystem({ path: walletStorePath() });

    await sdk.setItem("store", { state: { accounts: [], accessKeys: [] }, version: 0 });

    expect((await storeFile())["tempo-cli.remotePayers"].payers).toHaveProperty(
      testWallet.toLowerCase(),
    );
    expect((await loadRemotePayer(testWallet))?.address).toBe(payer.address);
  });

  it("is restored from the backup when a concurrent rewrite dropped it from the store", async () => {
    const payer = await ensureRemotePayer(testWallet);
    // A writer that read the file before the payer existed writes back without it.
    const { "tempo-cli.remotePayers": _payers, ...rest } = await storeFile();
    await writeFile(walletStorePath(), JSON.stringify(rest));

    expect((await loadRemotePayer(testWallet))?.address).toBe(payer.address);
    expect((await storeFile())["tempo-cli.remotePayers"].payers).toHaveProperty(
      testWallet.toLowerCase(),
    );
  });

  it("migrates a payer created before it moved into the wallet store, keeping the old file", async () => {
    const address = privateKeyToAccount(legacyKey).address;
    const legacy = `${JSON.stringify({
      version: 1,
      payers: { [testWallet.toLowerCase()]: { address, privateKey: legacyKey, createdAt: 1 } },
    })}\n`;
    await writeFile(remotePayersPath(), legacy, { mode: 0o600 });

    expect((await loadRemotePayer(testWallet))?.address).toBe(address);
    expect((await storeFile())["tempo-cli.remotePayers"].payers[testWallet.toLowerCase()]).toEqual({
      address,
      keyType: "secp256k1",
      handle: { kind: "secp256k1", privateKey: legacyKey },
      createdAt: 1,
    });
    expect(await readFile(remotePayersPath(), "utf8")).toBe(legacy);
    // And it is reused, never replaced.
    expect((await ensureRemotePayer(testWallet)).address).toBe(address);
  });

  it("refuses an entry whose address its key does not sign for", async () => {
    await ensureRemotePayer(testWallet);
    const file = await storeFile();
    file["tempo-cli.remotePayers"].payers[testWallet.toLowerCase()].address =
      privateKeyToAccount(legacyKey).address;
    await writeFile(walletStorePath(), JSON.stringify(file));
    await rm(remotePayersPath());

    await expect(loadRemotePayer(testWallet)).rejects.toMatchObject({ code: "E_USAGE" });
  });

  it("is kept when the wallet logs out", async () => {
    const payer = await ensureRemotePayer(testWallet);

    await logoutHandler({}, runContext(true));

    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
    expect((await storeFile())["tempo-cli.remotePayers"].payers).toHaveProperty(
      testWallet.toLowerCase(),
    );
    expect((await loadRemotePayer(testWallet))?.address).toBe(payer.address);
  });

  it("is listed by keys once a payment created it, and never created by listing", async () => {
    const before = await keysHandler();
    expect(before).not.toHaveProperty("remote_payer");
    expect(await loadRemotePayer(testWallet)).toBeUndefined();

    const payer = await ensureRemotePayer(testWallet);

    expect(await keysHandler()).toMatchObject({
      remote_payer: { address: payer.address.toLowerCase(), key_type: "secp256k1" },
    });
  });
});
