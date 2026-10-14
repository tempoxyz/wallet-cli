import { Storage } from "accounts/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toHex } from "viem";

import { refreshHandler, revokeHandler, updateAccessKeyHandler } from "../src/commands/identity.js";
import { createProvider } from "../src/provider.js";
import { revokeOutput } from "../src/schemas.js";
import { loadWalletState } from "../src/wallet/store.js";
import {
  expectUsageError,
  readyWallet,
  runContext,
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
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

/** A wallet-app provider that only takes requests, so nothing can be signed locally. */
function walletApp(chainId: number = mainnet.chainId) {
  const request = vi.fn();
  request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return toHex(chainId);
    if (method === "wallet_connect") return { accounts: [] };
    return undefined;
  });
  return { request, createProvider: vi.fn(() => ({ request })) };
}

describe("revoke", () => {
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

      const result = await revokeHandler(
        await readyWallet(network.name, false),
        { accessKey: testAccessKey },
        { yes: true },
        runContext(true),
        { confirm, createProvider: app.createProvider },
      );

      expect(app.createProvider).toHaveBeenCalledExactlyOnceWith({ network, noBrowser: false });
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

      const chainId = await createProvider({ network }).request({ method: "eth_chainId" });
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

  const listed = `Its keys on mainnet: ${testAccessKey.toLowerCase()}.`;
  it.each(
    [
      {
        name: "another wallet's key",
        accessKeys: [key, { ...key, address: testAccessKey2, access: testWallet2 }],
        detail: listed,
      },
      {
        name: "a key on another network",
        accessKeys: [key, { ...key, address: testAccessKey2, chainId: testnet.chainId }],
        detail: listed,
      },
      {
        name: "a key when the wallet holds none",
        accessKeys: [{ ...key, access: testWallet2 }],
        detail: "It has no keys on mainnet.",
      },
    ].flatMap((scenario) =>
      [{ "dry-run": true }, { yes: true }, {}].map((options) => ({ ...scenario, options })),
    ),
  )(
    "refuses $name with $options before doing anything",
    async ({ accessKeys, detail, options }) => {
      await useTempHome();
      await writeWalletState(walletState({ accessKeys }));
      const app = walletApp();
      const confirm = vi.fn();
      const context = runContext(false);

      const error = await revokeHandler(
        await readyWallet(undefined, false),
        { accessKey: testAccessKey2 },
        options,
        context,
        { confirm, createProvider: app.createProvider },
      ).catch((value: unknown) => value);

      expectUsageError(
        error,
        `Access key ${testAccessKey2.toLowerCase()} is not configured for wallet ${testWallet.toLowerCase()} on mainnet. ${detail}`,
      );
      expect(app.createProvider).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(context.error).not.toHaveBeenCalled();
      expect((await loadWalletState()).accessKeys).toEqual(accessKeys);
    },
  );

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
      { confirm, createProvider: app.createProvider },
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
          limit: null,
          raw_limit: null,
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
        { createProvider },
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
