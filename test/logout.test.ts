import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Storage } from "accounts/cli";
import { toHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logoutHandler } from "../src/commands/logout.js";
import { upsertSessionRecord, type PersistedSessionRecord } from "../src/payment/session-store.js";
import { logoutOutput } from "../src/schemas/logout.js";
import { networkFields } from "../src/shared/network.js";
import { nowSeconds } from "../src/shared/utils.js";
import {
  loadPendingLogin,
  loadWalletState,
  savePendingLogin,
  type PendingLogin,
  type WalletState,
} from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  approvingDeviceCode,
  keychain,
  runContext,
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  usdc,
  useTempHome,
  walletApp,
  walletState,
  writeWalletState,
  type KeyStatus,
} from "./helpers.js";

const interactiveStdout = join(import.meta.dirname, "fixtures", "interactive-stdout.mjs");
const mainnet = { name: "mainnet", chainId: 4217 } as const;
const testnet = { name: "testnet", chainId: 42431 } as const;
const key = walletState().accessKeys[0]!;
const key2 = { ...key, address: testAccessKey2, privateKey: testPrivateKey2 };
const testnetKey = { ...key2, chainId: testnet.chainId };
const otherWalletKey = { ...testnetKey, access: testWallet2 };
const bothNetworks = walletState({ accessKeys: [key, testnetKey] });
const notRevoked =
  "removed locally but not revoked, so authorized on-chain until expiry (use --revoke to revoke)";

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  // The stubbed key readers stand in for the chain, so no RPC override needs a chain check.
  vi.stubEnv("TEMPO_RPC_URL", undefined);
  // Any wallet-app or RPC request fails, so no test reaches a real service.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A key as logout reports it. */
function removed(accessKey: WalletState["accessKeys"][number], revoked = false) {
  return {
    address: accessKey.address.toLowerCase(),
    wallet_address: accessKey.access.toLowerCase(),
    ...networkFields(accessKey.chainId),
    revoked,
  };
}

/** A mainnet session of the test wallet holding 0.008 of its 0.01 USDC.e deposit. */
function session(overrides: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey,
    chain_id: mainnet.chainId,
    challenge_echo: "{}",
    channel_id: `0x${"a".repeat(64)}`,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: "0x0000000000000000000000000000000000000001",
    grace_ready_at: 0,
    last_used_at: 1,
    network: "tempo",
    origin: "https://example.com",
    payee: testWallet2,
    payer: testWallet,
    request_url: "https://example.com/",
    salt: `0x${"0".repeat(64)}`,
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdc,
    ...overrides,
  };
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pendingLogin(network: PendingLogin["network"]): PendingLogin {
  return {
    network,
    registration: {
      device_code: `device-${network}`,
      user_code: "ABCDEFGH",
      verification_uri: "https://wallet.tempo.xyz/device",
    },
    codeVerifier: "verifier",
    accessKey: { handle: { kind: "p256" }, publicKey: "0x04" },
    expiresAt: 2_000_000_000,
  };
}

async function setup(state: WalletState | undefined, sessions: PersistedSessionRecord[] = []) {
  await useTempHome();
  if (state) await writeWalletState(state);
  for (const record of sessions) await upsertSessionRecord(record);
}

describe("logout scope", () => {
  it.each<{
    name: string;
    state?: WalletState;
    options?: { network?: string };
    env?: string;
    result: Record<string, unknown>;
    after: Partial<WalletState>;
  }>([
    {
      name: "every network without --network",
      state: bothNetworks,
      result: {
        was_logged_in: true,
        disconnected: true,
        scope: "all",
        keys: [removed(key), removed(testnetKey)],
        message: `logged out of every network; wallet disconnected; 2 access keys ${notRevoked}`,
      },
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "only testnet with --network testnet",
      state: bothNetworks,
      options: { network: "testnet" },
      result: {
        was_logged_in: true,
        disconnected: false,
        scope: "testnet",
        keys: [removed(testnetKey)],
        message: `logged out of testnet; still logged in on mainnet; 1 access key ${notRevoked}`,
      },
      after: { accounts: [{ address: testWallet }], accessKeys: [key], chainId: mainnet.chainId },
    },
    {
      name: "only testnet when TEMPO_WALLET_NETWORK selects it",
      state: bothNetworks,
      env: "testnet",
      result: { scope: "testnet", disconnected: false, keys: [removed(testnetKey)] },
      after: { accounts: [{ address: testWallet }], accessKeys: [key], chainId: mainnet.chainId },
    },
    {
      name: "the stored network, moving the wallet to the network that keeps keys",
      state: bothNetworks,
      options: { network: "mainnet" },
      result: {
        was_logged_in: true,
        disconnected: false,
        scope: "mainnet",
        keys: [removed(key)],
        message: `logged out of mainnet; still logged in on testnet; 1 access key ${notRevoked}`,
      },
      after: {
        accounts: [{ address: testWallet }],
        accessKeys: [testnetKey],
        chainId: testnet.chainId,
      },
    },
    {
      name: "the wallet's only network",
      state: walletState({ chainId: testnet.chainId, accessKeys: [testnetKey] }),
      options: { network: "testnet" },
      result: {
        was_logged_in: true,
        disconnected: true,
        scope: "testnet",
        keys: [removed(testnetKey)],
        message: `logged out of testnet; wallet disconnected; 1 access key ${notRevoked}`,
      },
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "the wallet's only network when another wallet keeps a key elsewhere",
      state: walletState({ accessKeys: [key, otherWalletKey] }),
      options: { network: "mainnet" },
      result: {
        disconnected: true,
        keys: [removed(key)],
        message: `logged out of mainnet; wallet disconnected; 1 access key ${notRevoked}`,
      },
      after: { accounts: [], accessKeys: [otherWalletKey] },
    },
    {
      name: "the active wallet's only network when another stored account keeps a key elsewhere",
      state: walletState({
        accounts: [{ address: testWallet }, { address: testWallet2 }],
        accessKeys: [key, otherWalletKey],
      }),
      options: { network: "mainnet" },
      result: { disconnected: true, keys: [removed(key)] },
      after: { accounts: [], accessKeys: [otherWalletKey] },
    },
    {
      name: "the stored network of a wallet without keys",
      state: walletState({ accessKeys: [] }),
      options: { network: "mainnet" },
      result: {
        was_logged_in: true,
        disconnected: true,
        keys: [],
        message: "logged out of mainnet; wallet disconnected",
      },
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "nothing on a network the wallet is not logged in on",
      state: walletState(),
      options: { network: "testnet" },
      result: {
        was_logged_in: false,
        disconnected: false,
        wallet: testWallet.toLowerCase(),
        scope: "testnet",
        keys: [],
        message: "not logged in on testnet",
      },
      after: { accounts: [{ address: testWallet }], accessKeys: [key] },
    },
    {
      name: "nothing when no wallet is stored",
      result: {
        was_logged_in: false,
        disconnected: false,
        wallet: null,
        scope: "all",
        keys: [],
        message: "not logged in",
      },
      after: { accounts: [], accessKeys: [] },
    },
  ])("logs out of $name", async ({ state, options = {}, env, result, after }) => {
    await setup(state);
    if (env) vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    const context = runContext(true);

    const output = await logoutHandler(options, context);

    expect(context.error).not.toHaveBeenCalled();
    expect(logoutOutput.parse(output)).toMatchObject({
      wallet: state?.accounts.length ? testWallet.toLowerCase() : null,
      sessions: [],
      ...result,
    });
    expect(output).not.toHaveProperty("_next");
    expect(await loadWalletState()).toMatchObject(after);
  });

  it.each([
    { name: "every network", options: {}, kept: false },
    { name: "the login's network", options: { network: "testnet" }, kept: false },
    { name: "another network", options: { network: "mainnet" }, kept: true },
    { name: "a network without keys", state: walletState(), options: { network: "testnet" } },
    { name: "a store without a wallet", state: undefined, options: {} },
  ])(
    "logging out of $name clears a pending testnet login unless it is for another network",
    async ({ state = bothNetworks, options, kept = false }) => {
      await setup(state);
      await savePendingLogin(pendingLogin("testnet"));

      await logoutHandler(options, runContext(true));

      expect(await loadPendingLogin()).toEqual(kept ? pendingLogin("testnet") : undefined);
    },
  );

  it("fails without changing anything when it cannot cancel the pending login, until a retry can", async () => {
    await setup(bothNetworks);
    await savePendingLogin(pendingLogin("testnet"));
    // sqlite3 cannot lock a lock file that is not a database.
    const lock = join(homedir(), ".tempo", "wallet", "pending-login.lock");
    await writeFile(lock, "not a database");
    const before = await loadWalletState();
    const command = "tempo wallet logout --network testnet";

    expect(await logoutHandler({ network: "testnet" }, runContext(true))).toMatchObject({
      code: "E_RUNTIME",
      retryable: true,
      message: expect.stringMatching(
        new RegExp(
          `^Not logged out: the pending login could not be cancelled\\. sqlite3 failed to lock [\\s\\S]* Rerun '${command}' to retry\\.$`,
        ),
      ),
      cta: { commands: [{ command }] },
    });
    expect(await loadWalletState()).toEqual(before);
    expect(await loadPendingLogin()).toEqual(pendingLogin("testnet"));

    await rm(lock);
    expect(await logoutHandler({ network: "testnet" }, runContext(true))).toMatchObject({
      was_logged_in: true,
    });
    expect(await loadPendingLogin()).toBeUndefined();
  });

  it("with --revoke, revokes nothing when it cannot cancel the pending login, until a retry can", async () => {
    await setup(walletState());
    await savePendingLogin(pendingLogin("mainnet"));
    const lock = join(homedir(), ".tempo", "wallet", "pending-login.lock");
    await writeFile(lock, "not a database");
    const before = await loadWalletState();
    const app = walletApp();

    expect(
      await logoutHandler({ network: "mainnet", revoke: true, yes: true }, runContext(true), {
        createProvider: app.createProvider,
        readKey: keychain(),
      }),
    ).toMatchObject({
      code: "E_RUNTIME",
      retryable: true,
      cta: { commands: [{ command: "tempo wallet logout --revoke --yes --network mainnet" }] },
    });
    expect(app.createProvider).not.toHaveBeenCalled();
    expect(app.request).not.toHaveBeenCalled();
    expect(await loadWalletState()).toEqual(before);
    expect(await loadPendingLogin()).toEqual(pendingLogin("mainnet"));

    await rm(lock);
    expect(
      await logoutHandler({ network: "mainnet", revoke: true, yes: true }, runContext(true), {
        createProvider: app.createProvider,
        readKey: keychain("revoked"),
      }),
    ).toMatchObject({ keys: [{ chain_id: 4217, revoked: true }] });
    expect(await loadPendingLogin()).toBeUndefined();
  });
});

describe("logout with sessions holding deposits", () => {
  const closeAll = "tempo wallet sessions close --all --network mainnet";
  const summary =
    "Unspent deposits remain in 1 stored session: 0.008000 USDC.e with https://example.com on tempo (active).";

  it.each<{
    name: string;
    agent: boolean;
    options: { network?: string; yes?: boolean };
    answer?: boolean;
    cta?: string;
    declined?: boolean;
  }>([
    {
      name: "an agent run without --yes",
      agent: true,
      options: {},
      cta: "tempo wallet logout --yes",
    },
    {
      name: "an agent run on one network without --yes",
      agent: true,
      options: { network: "mainnet" },
      cta: "tempo wallet logout --yes --network mainnet",
    },
    { name: "an agent run with --yes", agent: true, options: { yes: true } },
    { name: "a confirmed prompt", agent: false, options: {}, answer: true },
    { name: "a declined prompt", agent: false, options: {}, answer: false, declined: true },
    { name: "an interactive run with --yes", agent: false, options: { yes: true } },
  ])("needs confirmation in $name", async ({ agent, options, answer, cta, declined }) => {
    await setup(walletState(), [session()]);
    const context = runContext(agent);
    const confirm = vi.fn(async () => answer ?? false);

    const output = await logoutHandler(options, context, { confirm }).catch(
      (error: unknown) => error,
    );

    const where = options.network ?? "every network";
    expect(confirm.mock.calls).toEqual(
      answer === undefined
        ? []
        : [
            [
              `${summary} Withdrawing them after logout needs a new login, so close them first with '${closeAll}'. Log out of ${where}?`,
            ],
          ],
    );
    if (cta)
      expect(output).toEqual({
        code: "E_USAGE",
        message: `Logging out of ${where} needs confirmation. ${summary} Withdrawing them after logout needs a new login, so close them first with '${closeAll}'. To log out anyway, run '${cta}'.`,
        exitCode: 2,
        retryable: false,
        cta: { commands: [{ command: cta }] },
      });
    if (declined)
      expect(output).toMatchObject({
        code: "E_USAGE",
        exitCode: 2,
        message: "Wallet not logged out.",
      });
    const loggedOut = !cta && !declined;
    if (loggedOut)
      expect(logoutOutput.parse(output)).toMatchObject({
        was_logged_in: true,
        sessions: [
          {
            channel_id: session().channel_id,
            network: "tempo",
            symbol: "USDC.e",
            remaining: "0.008000",
            status: "active",
          },
        ],
        instruction:
          "Unspent deposits remain in 1 stored session on mainnet. Log in again with 'tempo wallet login --network mainnet', then run the next command to close them and withdraw the deposits.",
        _next: { command: closeAll },
      });
    expect((await loadWalletState()).accounts).toEqual(loggedOut ? [] : [{ address: testWallet }]);
  });

  it.each<{
    name: string;
    state?: WalletState;
    record: Partial<PersistedSessionRecord>;
    options?: { network?: string };
    close?: string;
    remaining?: string;
  }>([
    { name: "an open session", record: {}, close: closeAll },
    {
      // A payment saves its cumulative before creating the voucher, which can then fail.
      name: "an open session whose latest cumulative the server never acknowledged",
      record: { cumulative_amount: 10_000n },
      close: closeAll,
    },
    {
      name: "a session by the voucher the server acknowledged",
      record: { accepted_cumulative: 5_000n, cumulative_amount: 5_000n },
      close: closeAll,
      remaining: "0.005000",
    },
    {
      name: "a session closing in its grace period",
      record: { state: "closing", close_requested_at: 1, grace_ready_at: nowSeconds() + 900 },
      close: closeAll,
    },
    {
      name: "a finalizable session",
      record: { state: "closing", close_requested_at: 1, grace_ready_at: 2 },
      close: "tempo wallet sessions close --finalize --network mainnet",
    },
    { name: "an orphaned channel", record: { state: "orphaned" }, close: closeAll },
    {
      name: "a testnet session on a logout of every network",
      record: { chain_id: testnet.chainId, token: "0x20c0000000000000000000000000000000000000" },
      close: "tempo wallet sessions close --all --network testnet",
    },
    { name: "a spent session", record: { accepted_cumulative: 10_000n } },
    { name: "a finalized session", record: { state: "finalized" } },
    { name: "another wallet's session", record: { payer: testWallet2 } },
    {
      name: "a testnet session on a mainnet logout that removes the wallet",
      record: { chain_id: testnet.chainId },
      options: { network: "mainnet" },
      close: "tempo wallet sessions close --all --network testnet",
    },
    {
      name: "a testnet session on a mainnet logout that keeps the wallet on testnet",
      state: bothNetworks,
      record: { chain_id: testnet.chainId },
      options: { network: "mainnet" },
    },
  ])(
    "counts $name",
    async ({ state = walletState(), record, options = {}, close, remaining = "0.008000" }) => {
      await setup(state, [session(record)]);
      const context = runContext(true);

      const output = await logoutHandler(options, context);

      if (close) {
        expect(output).toMatchObject({
          code: "E_USAGE",
          message: expect.stringMatching(
            new RegExp(`stored session: ${remaining} .*close them first with '${close}'`),
          ),
        });
        expect((await loadWalletState()).accounts).toEqual([{ address: testWallet }]);
      } else {
        expect(context.error).not.toHaveBeenCalled();
        const result = logoutOutput.parse(output);
        expect(result).toMatchObject({ was_logged_in: true, sessions: [] });
        expect((await loadWalletState()).accounts).toEqual(
          result.disconnected ? [] : [{ address: testWallet }],
        );
      }
    },
  );

  it("names each network's close when sessions on several networks hold deposits", async () => {
    await setup(bothNetworks, [
      session(),
      session({ channel_id: `0x${"b".repeat(64)}`, chain_id: testnet.chainId }),
    ]);

    const output = await logoutHandler({ yes: true }, runContext(true));

    expect(output).toMatchObject({
      sessions: [{ network: "tempo" }, { network: "tempo-moderato" }],
      instruction:
        "Unspent deposits remain in 2 stored sessions on 2 networks. To withdraw them, log in again on each network and close its sessions: 'tempo wallet login --network mainnet', then 'tempo wallet sessions close --all --network mainnet'; 'tempo wallet login --network testnet', then 'tempo wallet sessions close --all --network testnet'.",
    });
    expect(output).not.toHaveProperty("_next");
  });

  it.each([
    { name: "sqlite3 is missing and no session store exists", store: "none" },
    {
      name: "sqlite3 is missing and a session store exists",
      store: "sessions",
      refused: true,
      reason: "sqlite3 is not installed",
    },
    {
      name: "sqlite3 is missing, a session store exists, and --yes is set",
      store: "sessions",
      options: { yes: true },
      reason: "sqlite3 is not installed",
    },
    {
      name: "the session store is corrupt",
      store: "corrupt",
      refused: true,
      reason: "file is not a database",
    },
    {
      name: "the session store is corrupt and --yes is set",
      store: "corrupt",
      options: { yes: true },
      reason: "file is not a database",
    },
  ] satisfies {
    name: string;
    store: "none" | "sessions" | "corrupt";
    options?: { yes?: boolean };
    refused?: boolean;
    reason?: string;
  }[])(
    "logs out only with confirmation when $name",
    async ({ store, options = {}, refused = false, reason }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      const channels = join(home, ".tempo", "wallet", "channels.db");
      if (store === "sessions") await upsertSessionRecord(session());
      if (store === "corrupt") await writeFile(channels, "not a sqlite database ".repeat(8));
      if (store !== "corrupt") {
        await mkdir(join(home, "bin"));
        vi.stubEnv("PATH", join(home, "bin"));
      }
      const context = runContext(true);

      const output = await logoutHandler(options, context);

      const unchecked = `stored sessions in ${channels} could not be checked for unspent deposits (`;
      if (refused)
        expect(output).toMatchObject({
          code: "E_USAGE",
          message: expect.stringMatching(
            new RegExp(
              `^Logging out of every network needs confirmation\\. The ${escape(unchecked)}.*${reason}.*\\)\\. To log out anyway, run 'tempo wallet logout --yes'\\.$`,
            ),
          ),
        });
      else {
        const result = logoutOutput.parse(output);
        expect(result).toMatchObject({ was_logged_in: true, sessions: [] });
        // A logout confirmed without a readable store says the sessions went unchecked.
        expect(result.message).toMatch(
          reason
            ? new RegExp(`; ${escape(unchecked)}.*${reason}.*\\)$`)
            : /^(?!.*could not be checked)/,
        );
      }
      expect((await loadWalletState()).accounts).toEqual(refused ? [{ address: testWallet }] : []);
    },
  );
});

describe("logout --revoke", () => {
  it.each<{
    name: string;
    state: WalletState;
    options: { network?: string; browser?: boolean };
    revoked: WalletState["accessKeys"];
    after: Partial<WalletState>;
  }>([
    {
      name: "the wallet's key",
      state: walletState(),
      options: {},
      revoked: [key],
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "every key on the network",
      state: walletState({ accessKeys: [key, key2] }),
      options: { network: "mainnet" },
      revoked: [key, key2],
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "only the network's key, without a browser",
      state: bothNetworks,
      options: { network: "mainnet", browser: false },
      revoked: [key],
      after: { accessKeys: [testnetKey], chainId: testnet.chainId },
    },
  ])("revokes $name through the wallet app before removing it", async (scenario) => {
    await setup(scenario.state);
    const app = walletApp();
    const readKey = keychain(...scenario.revoked.map(() => "revoked" as const));
    const confirm = vi.fn();

    const output = await logoutHandler(
      { ...scenario.options, revoke: true, yes: true },
      runContext(true),
      { confirm, createProvider: app.createProvider, readKey },
    );

    expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({
      network: mainnet,
      noBrowser: scenario.options.browser === false,
    });
    expect(app.request.mock.calls).toEqual(
      scenario.revoked.map((revoked) => [
        {
          method: "wallet_revokeAccessKey",
          params: [
            {
              address: testWallet,
              accessKeyAddress: revoked.address,
              chainId: toHex(mainnet.chainId),
            },
          ],
        },
      ]),
    );
    expect(readKey.mock.calls).toEqual(
      scenario.revoked.map((revoked) => [
        {
          chainId: mainnet.chainId,
          walletAddress: testWallet,
          accessKeyAddress: revoked.address,
        },
      ]),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(logoutOutput.parse(output)).toMatchObject({
      was_logged_in: true,
      keys: scenario.revoked.map((revoked) => removed(revoked, true)),
      message: expect.stringContaining(
        `${scenario.revoked.length} access key${scenario.revoked.length === 1 ? "" : "s"} revoked on-chain and removed`,
      ),
    });
    expect(await loadWalletState()).toMatchObject(scenario.after);
  });

  it.each<{
    name: string;
    agent: boolean;
    answer?: boolean;
    cta?: string;
  }>([
    { name: "an agent run", agent: true, cta: "tempo wallet logout --revoke --yes" },
    { name: "a confirmed prompt", agent: false, answer: true },
    { name: "a declined prompt", agent: false, answer: false },
  ])("needs confirmation without --yes in $name", async ({ agent, answer, cta }) => {
    await setup(walletState());
    const app = walletApp();
    const confirm = vi.fn(async () => answer ?? false);
    const readKey = keychain("revoked");

    const output = await logoutHandler({ revoke: true }, runContext(agent), {
      confirm,
      createProvider: app.createProvider,
      readKey,
    }).catch((error: unknown) => error);

    const reason = "--revoke revokes 1 access key on-chain, which cannot be undone.";
    expect(confirm.mock.calls).toEqual(
      answer === undefined ? [] : [[`${reason} Log out of every network?`]],
    );
    if (cta)
      expect(output).toEqual({
        code: "E_USAGE",
        message: `Logging out of every network needs confirmation. ${reason} To log out anyway, run '${cta}'.`,
        exitCode: 2,
        retryable: false,
        cta: { commands: [{ command: cta }] },
      });
    if (answer === false) expect(output).toMatchObject({ message: "Wallet not logged out." });
    expect(app.createProvider).toHaveBeenCalledTimes(answer ? 1 : 0);
    expect((await loadWalletState()).accessKeys).toEqual(answer ? [] : [key]);
  });

  // An unused key expires before its authorization is published, so the chain does not hold it.
  const expiredKey = { ...key2, expiry: 1 };
  it.each<{
    name: string;
    state: WalletState;
    options: { yes?: boolean };
    /** The chain's answers in read order: expired keys are read first, then each revocation. */
    statuses: KeyStatus[];
    revoked: WalletState["accessKeys"];
  }>([
    {
      name: "an unpublished expired key next to a live one",
      state: walletState({ accessKeys: [expiredKey, key] }),
      options: { yes: true },
      statuses: ["missing", "revoked"],
      revoked: [key],
    },
    {
      name: "an only, unpublished expired key, with no confirmation",
      state: walletState({ accessKeys: [expiredKey] }),
      options: {},
      statuses: ["missing"],
      revoked: [],
    },
    {
      name: "an expired key the chain already shows revoked",
      state: walletState({ accessKeys: [expiredKey] }),
      options: {},
      statuses: ["revoked"],
      revoked: [],
    },
    {
      name: "an unpublished expired key on another network",
      state: walletState({ accessKeys: [key, { ...expiredKey, chainId: testnet.chainId }] }),
      options: { yes: true },
      statuses: ["missing", "revoked"],
      revoked: [key],
    },
    {
      name: "a key expired by the local clock but still published",
      state: walletState({ accessKeys: [expiredKey] }),
      options: { yes: true },
      statuses: ["published", "revoked"],
      revoked: [expiredKey],
    },
    {
      name: "a published key whose zero expiry the chain reads as none",
      state: walletState({ accessKeys: [{ ...key2, expiry: 0 }] }),
      options: { yes: true },
      statuses: ["published", "revoked"],
      revoked: [{ ...key2, expiry: 0 }],
    },
  ])("removes $name, revoking only what the chain shows published", async (scenario) => {
    const { state, options, statuses, revoked } = scenario;
    await setup(state);
    const app = walletApp();
    const readKey = keychain(...statuses);
    const context = runContext(true);

    const output = await logoutHandler({ ...options, revoke: true }, context, {
      createProvider: app.createProvider,
      readKey,
    });

    expect(context.error).not.toHaveBeenCalled();
    expect(app.createProvider).toHaveBeenCalledTimes(revoked.length > 0 ? 1 : 0);
    expect(
      app.request.mock.calls.flatMap(([call]) =>
        call.method === "wallet_revokeAccessKey" ? [call.params[0].accessKeyAddress] : [],
      ),
    ).toEqual(revoked.map((candidate) => candidate.address));
    expect(readKey).toHaveBeenCalledTimes(statuses.length);
    const result = logoutOutput.parse(output);
    expect(result.keys).toEqual(
      state.accessKeys.map((candidate) =>
        removed(
          candidate,
          revoked.some((other) => other.address === candidate.address),
        ),
      ),
    );
    expect(result.message.includes("expired access key removed without revoking")).toBe(
      revoked.length < state.accessKeys.length,
    );
    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
  });

  it("keeps everything when the chain cannot be read for an expired key", async () => {
    await setup(walletState({ accessKeys: [{ ...key2, expiry: 1 }] }));
    const app = walletApp();
    const readKey = vi.fn(async () => {
      throw new Error("Unable to read access key on-chain.");
    });

    const error = await logoutHandler({ revoke: true, yes: true }, runContext(true), {
      createProvider: app.createProvider,
      readKey,
    }).catch((value: unknown) => value);

    expect(error).toMatchObject({ message: "Unable to read access key on-chain." });
    expect(app.createProvider).not.toHaveBeenCalled();
    expect(await loadWalletState()).toMatchObject({
      accounts: [{ address: testWallet }],
      accessKeys: [{ ...key2, expiry: 1 }],
    });
  });

  it("logs out without a prompt when the network has no keys to revoke", async () => {
    await setup(walletState({ accessKeys: [] }));
    const app = walletApp();
    const confirm = vi.fn();

    const output = await logoutHandler({ network: "mainnet", revoke: true }, runContext(false), {
      confirm,
      createProvider: app.createProvider,
    });

    expect(output).toMatchObject({ was_logged_in: true, disconnected: true, keys: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(app.createProvider).not.toHaveBeenCalled();
  });

  const retry = "tempo wallet logout --revoke --yes";
  it.each<{
    name: string;
    state?: WalletState;
    statuses: ("revoked" | "published")[];
    request?: () => Promise<never>;
    code: string;
    exitCode: number;
    message: string;
    kept: WalletState["accessKeys"];
  }>([
    {
      name: "the chain does not show the key revoked",
      statuses: ["published"],
      code: "E_NETWORK",
      exitCode: 3,
      message: `Not logged out: access key ${testAccessKey} on mainnet was not revoked, so it stays on this machine with the wallet. The wallet app returned, but the chain does not show it revoked. Rerun '${retry}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
      kept: [key],
    },
    {
      name: "the wallet app request fails",
      statuses: [],
      request: async () => {
        throw new Error("Device code expired.");
      },
      code: "E_NETWORK",
      exitCode: 3,
      message: `Not logged out: access key ${testAccessKey} on mainnet was not revoked, so it stays on this machine with the wallet. Device code expired. Rerun '${retry}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
      kept: [key],
    },
    {
      name: "a later key is not revoked",
      state: walletState({ accessKeys: [key, key2] }),
      statuses: ["revoked", "published"],
      code: "E_NETWORK",
      exitCode: 3,
      message: `Not logged out: access key ${testAccessKey2.toLowerCase()} on mainnet was not revoked, so it stays on this machine with the wallet (revoked and removed: ${testAccessKey}). The wallet app returned, but the chain does not show it revoked. Rerun '${retry}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
      kept: [key2],
    },
  ])(
    "keeps the key and the wallet when $name",
    async ({ state = walletState(), statuses, request, code, exitCode, message, kept }) => {
      await setup(state);
      await savePendingLogin(pendingLogin("mainnet"));
      const app = walletApp();
      if (request) app.request.mockImplementation(request);
      const readKey = keychain(...statuses);

      const output = await logoutHandler({ revoke: true, yes: true }, runContext(true), {
        createProvider: app.createProvider,
        readKey,
      });

      expect(output).toEqual({
        code,
        message,
        exitCode,
        retryable: false,
        cta: { commands: [{ command: retry }] },
      });
      expect(await loadWalletState()).toMatchObject({
        accounts: [{ address: testWallet }],
        accessKeys: kept,
      });
      // The pending login is cancelled before any key is revoked.
      expect(await loadPendingLogin()).toBeUndefined();
    },
  );

  // The wallet is logged in on mainnet; each revocation names its key's network.
  it.each<{
    name: string;
    options: { network?: string };
    revoked: WalletState["accessKeys"];
    after: Partial<WalletState>;
  }>([
    {
      name: "keys on two networks",
      options: {},
      revoked: [key, testnetKey],
      after: { accounts: [], accessKeys: [] },
    },
    {
      name: "keys on a network the wallet is not logged in on",
      options: { network: "testnet" },
      revoked: [testnetKey],
      after: { accounts: [{ address: testWallet }], accessKeys: [key], chainId: mainnet.chainId },
    },
  ])("revokes $name on their own network", async ({ options, revoked, after }) => {
    await setup(bothNetworks);
    const app = walletApp();
    const readKey = keychain(...revoked.map(() => "revoked" as const));

    const output = await logoutHandler({ ...options, revoke: true, yes: true }, runContext(true), {
      createProvider: app.createProvider,
      readKey,
    });

    expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({
      network: mainnet,
      noBrowser: false,
    });
    expect(app.request.mock.calls).toEqual(
      revoked.map((revokedKey) => [
        {
          method: "wallet_revokeAccessKey",
          params: [
            {
              address: testWallet,
              accessKeyAddress: revokedKey.address,
              chainId: toHex(revokedKey.chainId),
            },
          ],
        },
      ]),
    );
    expect(readKey.mock.calls).toEqual(
      revoked.map((revokedKey) => [
        {
          chainId: revokedKey.chainId,
          walletAddress: testWallet,
          accessKeyAddress: revokedKey.address,
        },
      ]),
    );
    expect(logoutOutput.parse(output)).toMatchObject({
      was_logged_in: true,
      keys: revoked.map((revokedKey) => removed(revokedKey, true)),
    });
    expect(await loadWalletState()).toMatchObject(after);
  });

  it("asks the wallet app with the real SDK to revoke a key on another network there", async () => {
    await setup(bothNetworks);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const registered: unknown[] = [];
    // The wallet app issues a device code that expires before the user approves it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (!url.endsWith("/register"))
          return Response.json({ error: "expired_token" }, { status: 400 });
        registered.push(JSON.parse(init.body));
        return Response.json({
          device_code: "device",
          user_code: "ABCDEFGH",
          verification_uri: "https://wallet.tempo.xyz/device",
          verification_uri_complete: "https://wallet.tempo.xyz/device?user_code=ABCDEFGH",
        });
      }),
    );

    const output = await logoutHandler(
      { network: "testnet", revoke: true, yes: true, browser: false },
      runContext(true),
    );
    await Storage.filesystem().getItem("store");

    expect(output).toMatchObject({
      code: "E_NETWORK",
      message: expect.stringContaining("Device code expired"),
    });
    expect(registered).toEqual([
      expect.objectContaining({
        message: {
          type: "rpc-requests",
          payload: [
            expect.objectContaining({
              method: "wallet_revokeAccessKey",
              params: [
                {
                  address: testWallet,
                  accessKeyAddress: testnetKey.address,
                  chainId: toHex(testnet.chainId),
                },
              ],
              context: { account: testWallet, chainId: testnet.chainId },
            }),
          ],
        },
      }),
    ]);
    expect(await loadWalletState()).toMatchObject({ accessKeys: bothNetworks.accessKeys });
  });

  it("keeps the key and the wallet when a key on another network is not revoked", async () => {
    await setup(bothNetworks);
    const app = walletApp();
    const command = "tempo wallet logout --revoke --yes --network testnet";

    const output = await logoutHandler(
      { network: "testnet", revoke: true, yes: true },
      runContext(true),
      { createProvider: app.createProvider, readKey: keychain("published") },
    );

    expect(output).toEqual({
      code: "E_NETWORK",
      message: `Not logged out: access key ${testAccessKey2.toLowerCase()} on testnet was not revoked, so it stays on this machine with the wallet. The wallet app returned, but the chain does not show it revoked. Rerun '${command}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
      exitCode: 3,
      retryable: false,
      cta: { commands: [{ command }] },
    });
    expect(await loadWalletState()).toMatchObject({
      accounts: [{ address: testWallet }],
      accessKeys: bothNetworks.accessKeys,
    });
  });

  // Another process changes the store while a logout of mainnet waits at its prompt.
  it.each([
    {
      name: "a refresh on mainnet",
      before: walletState(),
      changed: walletState({ accessKeys: [key, key2] }),
      after: { accessKeys: [key2], chainId: mainnet.chainId },
    },
    {
      name: "a login on testnet",
      before: walletState(),
      changed: walletState({ chainId: testnet.chainId, accessKeys: [key, testnetKey] }),
      after: { accessKeys: [testnetKey], chainId: testnet.chainId },
    },
  ])("stops without writing after $name made meanwhile", async ({ before, changed, after }) => {
    await setup(before);
    const app = walletApp();
    const command = "tempo wallet logout --revoke --network mainnet";

    const output = await logoutHandler({ network: "mainnet", revoke: true }, runContext(false), {
      confirm: async () => {
        await writeWalletState(changed);
        return true;
      },
      createProvider: app.createProvider,
      readKey: keychain("revoked"),
    });

    expect(output).toEqual({
      code: "E_USAGE",
      message: `The wallet changed while logging out of mainnet, so it was not logged out (revoked on-chain and removed: ${testAccessKey}). Run '${command}' again.`,
      exitCode: 2,
      retryable: true,
      cta: { commands: [{ command }] },
    });
    expect(await loadWalletState()).toMatchObject({
      accounts: [{ address: testWallet }],
      ...after,
    });
  });

  // The SDK saves its store once the wallet app returns, which must not hide a login another
  // process made while the wallet app waited for approval.
  it("stops after a login on another network made while the wallet app waits, with the real SDK", async () => {
    await setup(walletState());
    const login = walletState({ chainId: testnet.chainId, accessKeys: [key, testnetKey] });
    approvingDeviceCode(() => writeWalletState(login));
    const command = "tempo wallet logout --revoke --yes --no-browser --network mainnet";

    const output = await logoutHandler(
      { network: "mainnet", revoke: true, yes: true, browser: false },
      runContext(true),
      { readKey: keychain("revoked") },
    );
    await Storage.filesystem().getItem("store");

    expect(output).toMatchObject({
      code: "E_USAGE",
      retryable: true,
      cta: { commands: [{ command }] },
    });
    expect(await loadWalletState()).toMatchObject({
      accounts: [{ address: testWallet }],
      accessKeys: [testnetKey],
      chainId: testnet.chainId,
    });
  });

  it("logs out after a change only to keys on another network made meanwhile", async () => {
    await setup(bothNetworks);
    const changed = walletState({ accessKeys: [key, testnetKey, otherWalletKey] });
    const app = walletApp();

    const output = await logoutHandler({ network: "mainnet", revoke: true }, runContext(false), {
      confirm: async () => {
        await writeWalletState(changed);
        return true;
      },
      createProvider: app.createProvider,
      readKey: keychain("revoked"),
    });

    expect(output).toMatchObject({
      disconnected: false,
      keys: [removed(key, true)],
      message: expect.stringContaining("still logged in on testnet"),
    });
    expect(await loadWalletState()).toMatchObject({
      accounts: [{ address: testWallet }],
      accessKeys: [testnetKey, otherWalletKey],
      chainId: testnet.chainId,
    });
  });

  it("revokes keys on two networks with a logout of each", async () => {
    await setup(bothNetworks);

    for (const network of [mainnet, testnet]) {
      const app = walletApp();
      const output = await logoutHandler(
        { network: network.name, revoke: true, yes: true },
        runContext(true),
        { createProvider: app.createProvider, readKey: keychain("revoked") },
      );
      expect(output).toMatchObject({ keys: [{ chain_id: network.chainId, revoked: true }] });
      expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({ network, noBrowser: false });
    }

    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
  });
});

describe("tempo wallet logout", () => {
  it.each([
    {
      name: "an agent run without --yes is refused",
      args: ["--format", "json"],
      exitCode: 2,
      output: { code: "E_USAGE", cta: { commands: [{ command: "tempo wallet logout --yes" }] } },
    },
    {
      name: "a terminal run with piped stdin is refused instead of prompting",
      args: [],
      interactive: true,
      exitCode: 2,
      output: "E_USAGE",
    },
    {
      name: "an agent run with --yes logs out",
      args: ["--yes", "--format", "json"],
      exitCode: 0,
      output: {
        was_logged_in: true,
        scope: "all",
        sessions: [{ remaining: "0.008000" }],
        _next: { command: "tempo wallet sessions close --all --network mainnet" },
      },
    },
  ])("$name when a session holds a deposit", async ({ args, interactive, exitCode, output }) => {
    await setup(walletState(), [session()]);

    const result = await wallet(["logout", ...args], { interactive });

    expect(result.code, result.stderr).toBe(exitCode);
    if (typeof output === "string") expect(result.stdout + result.stderr).toContain(output);
    else expect(JSON.parse(result.stdout)).toMatchObject(output);
    expect((await loadWalletState()).accounts).toEqual(
      exitCode === 0 ? [] : [{ address: testWallet }],
    );
  });
});

/** Runs the wallet CLI with piped stdin; `interactive` makes stdout look like a terminal. */
function wallet(args: string[], { interactive = false } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete env.TEMPO_WALLET_NETWORK;
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [...(interactive ? ["--import", interactiveStdout] : []), cliBundle("wallet"), ...args],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
