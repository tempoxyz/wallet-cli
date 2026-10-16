import { Rpc } from "accounts";
import { Storage } from "accounts/cli";
import { z } from "incur";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account } from "viem/tempo";

import { updateAccessKeyHandler } from "../src/commands/keys.js";
import { refreshHandler } from "../src/commands/refresh.js";
import { revokeHandler } from "../src/commands/revoke.js";
import { createProvider } from "../src/provider.js";
import { revokeOutput } from "../src/schemas/revoke.js";
import { loadWalletState } from "../src/wallet/store.js";
import {
  expectUsageError,
  keychain,
  readyWallet,
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

const key = walletState().accessKeys[0]!;
const mainnet = { name: "mainnet", chainId: 4217 } as const;
const testnet = { name: "testnet", chainId: 42431 } as const;

describe("revoke", () => {
  it.each([
    {
      name: "keeps the key when the chain does not show it revoked",
      status: "published" as const,
      error: `The wallet app returned, but access key ${testAccessKey} is not revoked on mainnet, so nothing was removed locally. Rerun the command to retry.`,
      kept: [key],
    },
    {
      name: "removes the key once the chain shows it revoked",
      status: "revoked" as const,
      kept: [],
    },
  ])("$name, after the SDK drops it from the store", async ({ status, error, kept }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp(mainnet.chainId, { dropsRevokedKey: true });

    const result = await revokeHandler(
      await readyWallet(undefined, false),
      { accessKey: testAccessKey },
      { yes: true },
      runContext(true),
      { createProvider: app.createProvider, readKey: keychain(status) },
    ).catch((value: unknown) => value);

    expect(app.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_revokeAccessKey" }),
    );
    if (error) expect(result).toMatchObject({ code: "E_NETWORK", exitCode: 3, message: error });
    else expect(result).toMatchObject({ status: "success", local_key_removed: true });
    expect((await loadWalletState()).accessKeys).toEqual(kept);
  });

  it.each([mainnet, testnet])(
    "revokes a $name key through the wallet app without signing locally",
    async (network) => {
      await useTempHome();
      const target = { ...key, chainId: network.chainId };
      const otherWallet = { ...target, access: testWallet2, privateKey: testPrivateKey2 };
      const otherChain = {
        ...target,
        chainId: network.chainId === mainnet.chainId ? testnet.chainId : mainnet.chainId,
      };
      await writeWalletState(
        walletState({ chainId: network.chainId, accessKeys: [otherWallet, target, otherChain] }),
      );
      const app = walletApp(network.chainId);
      const confirm = vi.fn();
      const readKey = keychain("revoked");

      const result = await revokeHandler(
        await readyWallet(network.name, false),
        { accessKey: testAccessKey },
        { yes: true },
        runContext(true),
        { confirm, createProvider: app.createProvider, readKey },
      );

      expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({ network, noBrowser: false });
      // The chain confirms the revocation on the key's network.
      expect(readKey.mock.calls).toEqual([
        [{ chainId: network.chainId, walletAddress: testWallet, accessKeyAddress: testAccessKey }],
      ]);
      expect(app.request.mock.calls).toEqual([
        [{ method: "eth_chainId" }],
        [
          {
            method: "wallet_revokeAccessKey",
            params: [{ address: testWallet, accessKeyAddress: testAccessKey }],
          },
        ],
      ]);
      expect(confirm).not.toHaveBeenCalled();
      expect(revokeOutput.parse(result)).toEqual({
        status: "success",
        wallet: testWallet.toLowerCase(),
        access_key: testAccessKey.toLowerCase(),
        chain_id: network.chainId,
        network: network.chainId === mainnet.chainId ? "tempo" : "tempo-moderato",
        local_key_removed: true,
      });
      expect((await loadWalletState()).accessKeys).toEqual([otherWallet, otherChain]);
    },
  );

  it("refuses a provider on another chain and keeps the key", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp(testnet.chainId);

    const error = await revokeHandler(
      await readyWallet(),
      { accessKey: testAccessKey },
      { yes: true },
      runContext(true),
      { createProvider: app.createProvider },
    ).catch((value: unknown) => value);

    expectUsageError(
      error,
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
    expect(app.request.mock.calls).toEqual([[{ method: "eth_chainId" }]]);
    expect((await loadWalletState()).accessKeys).toEqual([key]);
  });

  it.each([mainnet, testnet])(
    "the wallet SDK provider created for $name targets the logged-in chain",
    async (network) => {
      await useTempHome();
      await writeWalletState(walletState({ chainId: network.chainId }));

      const chainId = await (await createProvider({ network })).request({ method: "eth_chainId" });
      await Storage.filesystem().getItem("store");

      expect(Number(chainId)).toBe(network.chainId);
    },
  );

  // The store holds only the wallet address and its access key, as after a device-code login.
  it("asks the wallet app with the real SDK and keeps the key when it fails", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await revokeHandler(
      await readyWallet(),
      { accessKey: testAccessKey },
      { yes: true, browser: false },
      runContext(true),
    ).catch((value: unknown) => value);
    await Storage.filesystem().getItem("store");

    expect(error).toMatchObject({
      message: expect.stringContaining("device-code register failed: offline"),
    });
    expect((await loadWalletState()).accessKeys).toEqual([key]);
  });

  it.each([mainnet, testnet])(
    "a timed-out $name revoke asks the wallet app once",
    async (network) => {
      await useTempHome();
      await writeWalletState(
        walletState({
          chainId: network.chainId,
          accessKeys: [{ ...key, chainId: network.chainId }],
        }),
      );
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

      const error = await revokeHandler(
        await readyWallet(network.name),
        { accessKey: testAccessKey },
        { yes: true, browser: false },
        runContext(true),
      ).catch((value: unknown) => value);
      await Storage.filesystem().getItem("store");

      expect(error).toMatchObject({ message: expect.stringContaining("Device code expired") });
      // One approval request, which carries the key's chain since the RPC has no chain parameter.
      expect(registered).toEqual([
        expect.objectContaining({
          message: {
            type: "rpc-requests",
            payload: [
              expect.objectContaining({
                method: "wallet_revokeAccessKey",
                params: [{ address: testWallet, accessKeyAddress: testAccessKey }],
                context: { account: testWallet, chainId: network.chainId },
              }),
            ],
          },
        }),
      ]);
      expect((await loadWalletState()).accessKeys).toEqual([{ ...key, chainId: network.chainId }]);
    },
  );

  const listed = `Its stored keys on mainnet: ${testAccessKey.toLowerCase()}.`;
  it.each(
    [
      {
        name: "another wallet's key",
        accessKeys: [key, { ...key, address: testAccessKey2, access: testWallet2 }],
        detail: listed,
        status: "missing" as const,
      },
      {
        name: "a key on another network",
        accessKeys: [key, { ...key, address: testAccessKey2, chainId: testnet.chainId }],
        detail: listed,
        status: "missing" as const,
      },
      {
        name: "a key when the wallet holds none",
        accessKeys: [{ ...key, access: testWallet2 }],
        detail: "It has no stored keys on mainnet.",
        status: "missing" as const,
      },
      {
        name: "an unstored key already revoked on-chain",
        accessKeys: [key],
        detail: listed,
        status: "revoked" as const,
      },
    ].flatMap((scenario) =>
      [{ "dry-run": true }, { yes: true }, {}].map((options) => ({ ...scenario, options })),
    ),
  )(
    "refuses $name with $options before doing anything",
    async ({ accessKeys, detail, status, options }) => {
      await useTempHome();
      await writeWalletState(walletState({ accessKeys }));
      const app = walletApp();
      const confirm = vi.fn();
      const context = runContext(false);
      const readKey = keychain(status);

      const error = await revokeHandler(
        await readyWallet(undefined, false),
        { accessKey: testAccessKey2 },
        options,
        context,
        { confirm, createProvider: app.createProvider, readKey },
      ).catch((value: unknown) => value);

      expectUsageError(
        error,
        `Access key ${testAccessKey2.toLowerCase()} is not stored for wallet ${testWallet.toLowerCase()} on mainnet or authorized for it on-chain. ${detail}`,
      );
      expect(readKey.mock.calls).toEqual([
        [{ chainId: mainnet.chainId, walletAddress: testWallet, accessKeyAddress: testAccessKey2 }],
      ]);
      expect(app.createProvider).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(context.error).not.toHaveBeenCalled();
      expect((await loadWalletState()).accessKeys).toEqual(accessKeys);
    },
  );

  it.each([
    { name: "a dry run", options: { "dry-run": true }, revoked: false },
    { name: "a confirmed run", options: { yes: true }, revoked: true },
  ])("revokes a key created elsewhere and authorized on-chain in $name", async (scenario) => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp();
    const readKey = vi
      .fn()
      .mockResolvedValueOnce({ status: "published", expiry: 2_000_000_000 })
      .mockResolvedValueOnce({ status: "revoked", expiry: 2_000_000_000 });

    const result = await revokeHandler(
      await readyWallet(),
      { accessKey: testAccessKey2 },
      scenario.options,
      runContext(true),
      { createProvider: app.createProvider, readKey },
    );

    expect(revokeOutput.parse(result)).toMatchObject(
      scenario.revoked
        ? { status: "success", access_key: testAccessKey2.toLowerCase(), local_key_removed: false }
        : {
            status: "dry_run",
            access_key: testAccessKey2.toLowerCase(),
            key: {
              address: testAccessKey2.toLowerCase(),
              wallet_address: testWallet.toLowerCase(),
              spending_limit: { mode: "unknown" },
              spending_limits: [],
              expires_at: "2033-05-18T03:33:20Z",
            },
          },
    );
    expect(readKey).toHaveBeenCalledTimes(scenario.revoked ? 2 : 1);
    expect(app.request).toHaveBeenCalledTimes(scenario.revoked ? 2 : 0);
    expect((await loadWalletState()).accessKeys).toEqual([key]);
  });

  const cta = (...flags: string[]) =>
    [
      "tempo wallet revoke",
      testAccessKey.toLowerCase(),
      "--yes",
      ...flags,
      "--network mainnet",
    ].join(" ");
  it.each([
    {
      name: "an agent run without --yes",
      agent: true,
      options: {},
      refused: cta(),
    },
    {
      name: "an agent run without --yes or a browser",
      agent: true,
      options: { browser: false },
      refused: cta("--no-browser"),
    },
    { name: "an agent run with --yes", agent: true, options: { yes: true }, revoked: true },
    {
      name: "a confirmed interactive run",
      agent: false,
      options: {},
      answer: true,
      revoked: true,
    },
    { name: "a declined interactive run", agent: false, options: {}, answer: false },
    { name: "an interactive run with --yes", agent: false, options: { yes: true }, revoked: true },
  ])("confirms $name", async ({ agent, options, answer, refused, revoked = false }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp();
    const confirm = vi.fn(async () => answer ?? false);
    const context = runContext(agent);

    const result = await revokeHandler(
      await readyWallet(),
      { accessKey: testAccessKey },
      options,
      context,
      { confirm, createProvider: app.createProvider, readKey: keychain("revoked") },
    ).catch((value: unknown) => value);

    if (refused) {
      expect(result).toEqual({
        code: "E_USAGE",
        message: `Revocation cannot be undone, so it needs confirmation. Review the key with --dry-run, then run '${refused}'.`,
        exitCode: 2,
        retryable: false,
        cta: { commands: [{ command: refused }] },
      });
      expect(context.error).toHaveBeenCalledOnce();
    } else expect(context.error).not.toHaveBeenCalled();
    expect(confirm.mock.calls).toEqual(
      answer === undefined
        ? []
        : [
            [
              `Revoke access key ${testAccessKey.toLowerCase()} for wallet ${testWallet.toLowerCase()} on mainnet? This cannot be undone.`,
            ],
          ],
    );
    if (answer === false) expectUsageError(result, "Access key not revoked.");
    expect(app.createProvider).toHaveBeenCalledTimes(revoked ? 1 : 0);
    expect(result).toMatchObject(revoked ? { status: "success" } : {});
    expect((await loadWalletState()).accessKeys).toEqual(revoked ? [] : [key]);
  });

  it.each([
    { name: "", options: {}, flags: [] },
    { name: " without a browser", options: { browser: false }, flags: ["--no-browser"] },
  ])("dry-runs show the key and continue with --yes$name", async ({ options, flags }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp();
    const confirm = vi.fn();
    const context = runContext(true);

    const result = await revokeHandler(
      await readyWallet(),
      { accessKey: testAccessKey },
      { ...options, "dry-run": true },
      context,
      { confirm, createProvider: app.createProvider },
    );

    const argv = [
      "tempo",
      "wallet",
      "revoke",
      testAccessKey.toLowerCase(),
      "--yes",
      ...flags,
      "--network",
      "mainnet",
    ];
    expect(revokeOutput.parse(result)).toEqual({
      status: "dry_run",
      wallet: testWallet.toLowerCase(),
      access_key: testAccessKey.toLowerCase(),
      chain_id: 4217,
      network: "tempo",
      local_key_removed: false,
      key: {
        address: testAccessKey.toLowerCase(),
        chain_id: 4217,
        network: "tempo",
        wallet_address: testWallet.toLowerCase(),
        symbol: "USDC.e",
        token: key.limits![0]!.token.toLowerCase(),
        balance: null,
        spending_limit: {
          mode: "unknown",
          unlimited: null,
          limit: "100.000000",
          raw_limit: "100000000",
          period_seconds: null,
          remaining: null,
          spent: null,
        },
        spending_limits: [
          {
            unlimited: false,
            symbol: "USDC.e",
            token: key.limits![0]!.token.toLowerCase(),
            limit: "100.000000",
            raw_limit: "100000000",
            period_seconds: null,
            remaining: null,
            spent: null,
          },
        ],
        call_permissions: "unknown",
        scopes: [],
        status: "ready",
        published: null,
        expires_at: "2033-05-18T03:33:20Z",
      },
      instruction:
        "Review the key, then run the next command to revoke it on-chain. Revocation cannot be undone.",
      _next: { argv, command: argv.join(" ") },
    });
    expect(app.createProvider).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(context.error).not.toHaveBeenCalled();
    expect((await loadWalletState()).accessKeys).toEqual([key]);
  });

  it.each<{ name: string; pending: boolean; reads: KeyStatus[]; authorizes: boolean; ok: boolean }>(
    [
      { name: "a published key", pending: false, reads: ["revoked"], authorizes: false, ok: true },
      {
        name: "a pending key not yet published",
        pending: true,
        reads: ["missing", "revoked"],
        authorizes: true,
        ok: true,
      },
      {
        name: "a pending key published since login",
        pending: true,
        reads: ["published", "revoked"],
        authorizes: false,
        ok: true,
      },
      {
        name: "a key the wallet app did not revoke",
        pending: false,
        reads: ["missing"],
        authorizes: false,
        ok: false,
      },
      {
        name: "a pending key the wallet app did not revoke",
        pending: true,
        reads: ["missing", "missing"],
        authorizes: true,
        ok: false,
      },
    ],
  )(
    "revokes $name only once the chain shows it revoked",
    async ({ pending, reads, authorizes, ok }) => {
      await useTempHome();
      const keyAuthorization = await Account.fromSecp256k1(testPrivateKey2).signKeyAuthorization(
        { accessKeyAddress: testAccessKey, keyType: "secp256k1" },
        { chainId: 4217n, expiry: 2_000_000_000, limits: [{ token: usdc, limit: 100_000_000n }] },
      );
      const stored = pending ? { ...key, keyAuthorization } : key;
      await writeWalletState(walletState({ accessKeys: [stored] }));
      const before = (await loadWalletState()).accessKeys;
      const app = walletApp();
      const readKey = keychain(...reads);

      const result = await revokeHandler(
        await readyWallet(),
        { accessKey: testAccessKey },
        { yes: true },
        runContext(true),
        { createProvider: app.createProvider, readKey },
      ).catch((value: unknown) => value);

      const [, [revoke]] = app.request.mock.calls as [unknown, [{ params: [unknown] }]];
      const sent = z.decode(Rpc.wallet_revokeAccessKey.parameters, revoke.params[0] as never);
      // An unpublished key is authorized and revoked in one transaction.
      expect(sent).toEqual({
        address: testWallet,
        accessKeyAddress: testAccessKey,
        ...(authorizes ? { keyAuthorization } : {}),
      });
      expect(readKey).toHaveBeenCalledTimes(reads.length);
      if (ok) expect(result).toMatchObject({ status: "success", local_key_removed: true });
      else
        expect(result).toMatchObject({
          code: "E_NETWORK",
          message: `The wallet app returned, but access key ${testAccessKey.toLowerCase()} is not revoked on mainnet, so nothing was removed locally. Rerun the command to retry.`,
        });
      expect((await loadWalletState()).accessKeys).toEqual(ok ? [] : before);
    },
  );

  it("rejects a malformed access key address", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await revokeHandler(
      await readyWallet(),
      { accessKey: "not-an-address" },
      { yes: true },
      runContext(true),
    ).catch((value: unknown) => value);

    expectUsageError(error, "Invalid access key address: expected a 0x address");
  });
});

// Each command asks the wallet app through a provider created with or without a browser.
const walletAppCommands = [
  {
    command: "refresh",
    run: (
      browser: boolean | undefined,
      createProvider: ReturnType<typeof walletApp>["createProvider"],
    ) => refreshHandler({ browser }, createProvider),
    request: "wallet_connect",
  },
  {
    command: "keys update",
    run: async (
      browser: boolean | undefined,
      createProvider: ReturnType<typeof walletApp>["createProvider"],
    ) => updateAccessKeyHandler(await readyWallet(), { limit: "1", browser }, createProvider),
    request: "wallet_updateAccessKey",
  },
  {
    command: "revoke",
    run: async (
      browser: boolean | undefined,
      createProvider: ReturnType<typeof walletApp>["createProvider"],
    ) =>
      revokeHandler(
        await readyWallet(),
        { accessKey: testAccessKey },
        { yes: true, browser },
        runContext(true),
        { createProvider, readKey: keychain("revoked") },
      ),
    request: "wallet_revokeAccessKey",
  },
];

it.each(
  walletAppCommands.flatMap((command) =>
    [
      { browser: undefined, noBrowser: false },
      { browser: true, noBrowser: false },
      { browser: false, noBrowser: true },
    ].map((flag) => ({ ...command, ...flag })),
  ),
)(
  "$command with browser $browser asks the wallet app with noBrowser $noBrowser",
  async ({ run, request, browser, noBrowser }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const app = walletApp();

    await run(browser, app.createProvider);

    expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({ network: mainnet, noBrowser });
    expect(app.request).toHaveBeenCalledWith(expect.objectContaining({ method: request }));
  },
);

// The real wallet SDK, whose wallet-app request fails before the user can approve it.
it.each<{ command: string; run: () => Promise<unknown> }>([
  { command: "refresh", run: () => refreshHandler({ browser: false }) },
  {
    command: "keys update",
    run: async () =>
      updateAccessKeyHandler(await readyWallet(), {
        accessKey: testAccessKey,
        limit: "250",
        browser: false,
      }),
  },
])("a failed $command keeps the stored keys", async ({ run }) => {
  await useTempHome();
  const expired = { ...key, address: testAccessKey2, privateKey: testPrivateKey2, expiry: 1 };
  await writeWalletState(walletState({ accessKeys: [key, expired] }));
  const before = (await loadWalletState()).accessKeys;

  await expect(run()).rejects.toThrow("device-code register failed: offline");
  // The SDK persists its store in the background; wait for its queued writes.
  await Storage.filesystem().getItem("store");

  expect((await loadWalletState()).accessKeys).toEqual(before);
});
