import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clearPendingFund,
  clearPendingLogin,
  emptyWalletState,
  loadPendingFund,
  loadPendingLogin,
  loadWalletState,
  parsePendingFund,
  pendingFundPath,
  pendingLoginPath,
  savePendingFund,
  savePendingLogin,
  saveWalletState,
  walletStorePath,
} from "../src/wallet/store.js";

import {
  readWalletStoreJson,
  testAccessKey,
  testAccessKey2,
  testPrivateKey,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  usdc,
  walletState,
  walletStoreExists,
  writeLegacyKeysToml,
  writeRawWalletStore,
} from "./helpers.js";

describe("wallet store file", () => {
  it.each([
    { limits: null },
    { limits: {} },
    { limits: [{ token: 1, limit: "100" }] },
    { limits: [{ token: usdc, limit: 100 }] },
    { limits: [{ token: usdc, limit: "100", period: "86400" }] },
    { limits: [null] },
    { scopes: null },
    { scopes: {} },
    { scopes: [null] },
    { scopes: [{ address: 42 }] },
    { scopes: [{ address: usdc, selector: 42 }] },
    { scopes: [{ address: usdc, recipients: [testWallet2, 42] }] },
  ])("loads malformed permissions as unknown: %#", async (permissions) => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            ...walletState(),
            accessKeys: [
              { ...walletState().accessKeys[0]!, permissionSemantics: 1, ...permissions },
            ],
          },
          version: 0,
        },
      }),
    );
    const [key] = (await loadWalletState()).accessKeys;
    expect(key?.address).toBe(testAccessKey);
    expect(key?.permissionSemantics).toBeUndefined();
  });

  it("resolves under the active HOME", async () => {
    const home = await useTempHome();

    expect(walletStorePath()).toBe(join(home, ".tempo", "wallet", "store.json"));
  });

  it("saves the current envelope with default active account and chain", async () => {
    const home = await useTempHome();
    await saveWalletState({
      accounts: [{ address: testWallet }],
      accessKeys: [],
    });

    expect(await readFile(join(home, ".tempo", "wallet", "store.json"), "utf8")).toMatch(
      /"tempo-cli.store"/,
    );
    expect(await readWalletStoreJson()).toEqual({
      "tempo-cli.store": {
        state: {
          accounts: [{ address: testWallet }],
          accessKeys: [],
          activeAccount: 0,
          chainId: 4217,
        },
        version: 0,
      },
    });
  });

  it("stores wallet state under private directory and file permissions", async () => {
    const home = await useTempHome();
    await saveWalletState(walletState());

    await expectMode(join(home, ".tempo"), 0o700);
    await expectMode(join(home, ".tempo", "wallet"), 0o700);
    await expectMode(join(home, ".tempo", "wallet", "store.json"), 0o600);
  });

  it("tightens permissions for existing wallet store paths", async () => {
    const home = await useTempHome();
    const tempoDir = join(home, ".tempo");
    const walletDir = join(tempoDir, "wallet");
    const storePath = join(walletDir, "store.json");
    await chmod(tempoDir, 0o755);
    await chmod(walletDir, 0o755);
    await writeFile(storePath, "{}");
    await chmod(storePath, 0o644);

    await saveWalletState(walletState());

    await expectMode(tempoDir, 0o700);
    await expectMode(walletDir, 0o700);
    await expectMode(storePath, 0o600);
  });

  it("loads an empty state from missing or malformed envelopes", async () => {
    await useTempHome();

    expect(await loadWalletState()).toEqual(emptyWalletState());

    for (const body of [
      "{}",
      '{"tempo-cli.store": null}',
      '{"tempo-cli.store": {}}',
      '{"tempo-cli.store": {"state": null}}',
      '{"tempo-cli.store": {"state": "not-an-object"}}',
    ]) {
      await writeRawWalletStore(body);
      expect(await loadWalletState()).toEqual(emptyWalletState());
    }
  });

  it("filters malformed accounts, keys, and optional scalar fields", async () => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            accounts: [{ address: testWallet }, { address: 42 }, null, { other: testWallet2 }],
            activeAccount: "0",
            chainId: "4217",
            accessKeys: [
              {
                access: testWallet,
                address: testAccessKey,
                chainId: 4217,
                expiry: "1783809942",
                keyAuthorization: {
                  address: testAccessKey,
                  nested: ["100#__bigint", { limit: "250#__bigint" }],
                },
                keyType: 1,
                privateKey: false,
                limits: [{ token: usdc, limit: "100000000#__bigint", period: 86_400 }],
                scopes: [
                  {
                    address: usdc,
                    selector: "transfer(address,uint256)",
                    recipients: [testWallet2],
                  },
                ],
              },
              {
                access: testWallet,
                address: testAccessKey2,
                chainId: "4217",
                limits: [],
              },
              {
                access: testWallet,
                chainId: 4217,
                limits: [],
              },
              null,
            ],
          },
          version: 0,
        },
      }),
    );

    expect(await loadWalletState()).toEqual({
      accounts: [{ address: testWallet }],
      accessKeys: [
        {
          access: testWallet,
          address: testAccessKey,
          chainId: 4217,
          expiry: undefined,
          keyAuthorization: {
            address: testAccessKey,
            nested: [100n, { limit: 250n }],
          },
          keyType: undefined,
          privateKey: undefined,
          limits: [{ token: usdc, limit: "100000000#__bigint", period: 86_400 }],
          scopes: [
            {
              address: usdc,
              selector: "transfer(address,uint256)",
              recipients: [testWallet2],
            },
          ],
        },
      ],
      activeAccount: undefined,
      chainId: undefined,
    });
  });

  it("loads an account's key type but saves accounts as addresses only", async () => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            accounts: [
              { address: testWallet, keyType: "secp256k1", privateKey: testPrivateKey },
              { address: testWallet2, keyType: 1 },
            ],
          },
          version: 0,
        },
      }),
    );

    const state = await loadWalletState();
    expect(state.accounts).toEqual([
      { address: testWallet, keyType: "secp256k1" },
      { address: testWallet2 },
    ]);

    await saveWalletState(state);
    const saved = (await readWalletStoreJson()) as {
      "tempo-cli.store": { state: { accounts: unknown } };
    };
    expect(saved["tempo-cli.store"].state.accounts).toEqual([
      { address: testWallet },
      { address: testWallet2 },
    ]);
  });

  it("round trips nested key authorization bigint values", async () => {
    await useTempHome();
    const keyAuthorization = {
      chainId: 4217n,
      limits: [{ limit: 100000000n, token: usdc }],
      signature: { bytes: "0x1234", nonce: 7n },
    };
    await saveWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization,
          },
        ],
      }),
    );

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization,
          },
        ],
      }),
    );
  });

  it("round trips accounts SDK managed access key material", async () => {
    await useTempHome();
    const managedKey = {
      ...walletState().accessKeys[0]!,
      handle: { jwk: { crv: "P-256", kty: "EC" }, kind: "webcrypto-p256" },
      keyType: "p256",
      privateKey: undefined,
      publicKey: "0x04abcd",
    };

    await saveWalletState(walletState({ accessKeys: [managedKey] }));

    expect(await loadWalletState()).toEqual(walletState({ accessKeys: [managedKey] }));
  });

  it("round trips access key limit periods and call scopes", async () => {
    await useTempHome();
    const state = walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          limits: [
            { token: usdc, limit: "100000000#__bigint", period: 86_400 },
            {
              token: "0x1111111111111111111111111111111111111111",
              limit: "2500000#__bigint",
            },
          ],
          scopes: [
            {
              address: usdc,
              selector: "transfer(address,uint256)",
              recipients: [testWallet2],
            },
            {
              address: "0x1111111111111111111111111111111111111111",
              recipients: [],
            },
          ],
        },
      ],
    });

    await saveWalletState(state);

    expect(await loadWalletState()).toEqual(state);
  });

  it("round trips explicit empty access key scopes", async () => {
    await useTempHome();
    const state = walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          scopes: [],
        },
      ],
    });

    await saveWalletState(state);

    expect(await loadWalletState()).toEqual(state);
  });

  it("can save a state after loading revived bigint authorizations", async () => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            accounts: [{ address: testWallet }],
            activeAccount: 0,
            accessKeys: [
              {
                access: testWallet,
                address: testAccessKey,
                chainId: 4217,
                keyAuthorization: { chainId: "4217#__bigint" },
                limits: [{ token: usdc, limit: "100000000#__bigint" }],
                privateKey: testPrivateKey,
              },
            ],
            chainId: 4217,
          },
          version: 0,
        },
      }),
    );

    const loaded = await loadWalletState();
    await saveWalletState(loaded);

    expect(await loadWalletState()).toEqual(loaded);
  });

  it("migrates legacy TOML with comments, escaped strings, booleans, and CRLF line endings", async () => {
    await useTempHome();
    await writeLegacyKeysToml(
      [
        "# Tempo wallet keys",
        "[[keys]]",
        `wallet_address = "${testWallet}" # comment outside string`,
        "chain_id = 4217",
        'key_type = "p256"',
        `key_address = "${testAccessKey}"`,
        `key = "${testPrivateKey}"`,
        'key_authorization = "0x12#34"',
        "provisioned = true",
        "expiry = 1783809942",
        "",
        "[[keys.limits]]",
        `currency = "${usdc}"`,
        'limit = "100000000"',
        "",
      ].join("\r\n"),
    );

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            expiry: 1783809942,
            keyAuthorization: "0x12#34",
            keyType: "p256",
          },
        ],
      }),
    );
  });

  it("uses the first migrated key chain and persists migration once", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
chain_id = 42431
key_address = "${testAccessKey}"
key = "${testPrivateKey}"

[[keys]]
wallet_address = "${testWallet2}"
chain_id = 4217
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"
`);

    const migrated = await loadWalletState();
    expect(migrated.chainId).toBe(42431);
    expect(migrated.accounts).toEqual([{ address: testWallet }, { address: testWallet2 }]);
    expect(await walletStoreExists()).toBe(true);

    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet2}"
chain_id = 4217
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"
`);

    expect(await loadWalletState()).toEqual(migrated);
  });

  it("ignores legacy limits that are outside a key or missing required fields", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys.limits]]
currency = "${usdc}"
limit = "999"

[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"

[[keys.limits]]
currency = "${usdc}"

[[keys.limits]]
limit = "100000000"
`);

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            expiry: undefined,
            keyAuthorization: undefined,
            limits: [],
          },
        ],
        chainId: 4217,
      }),
    );
  });
});

describe("pending login file", () => {
  const pending = (deviceCode: string) => ({
    network: "testnet" as const,
    registration: {
      device_code: deviceCode,
      user_code: "ABCDEFGH",
      verification_uri: "https://wallet.tempo.xyz/api/auth/device/verify",
    },
    codeVerifier: "verifier",
    accessKey: { handle: { kind: "webcrypto-p256" }, publicKey: "0x04" as const },
    expiresAt: 2_000_000_000,
  });

  it.each([
    { name: "any login", clear: undefined, left: undefined },
    { name: "the saved login", clear: "device-2", left: undefined },
    { name: "a login it replaced", clear: "device-1", left: "device-2" },
  ])("clearing $name leaves $left", async ({ clear, left }) => {
    await useTempHome();
    await savePendingLogin(pending("device-1"));
    await savePendingLogin(pending("device-2"));
    await expectMode(pendingLoginPath(), 0o600);

    await clearPendingLogin(clear);

    expect((await loadPendingLogin())?.registration.device_code).toBe(left);
  });
});

describe("pending funding file", () => {
  const pending = (url: string) =>
    parsePendingFund({
      network: "mainnet",
      action: "mach",
      wallet: "0x1111111111111111111111111111111111111111",
      activeWallet: false,
      url,
      amount: "10",
      assets: [
        {
          token: "0x20c000000000000000000000f37de3740adec032",
          symbol: "MACH",
          baseline: "3000000",
          minimum: "10000000",
        },
      ],
      expiresAt: 2_000_000_000,
    });

  it("saves the funding for the owner only and loads it back", async () => {
    await useTempHome();
    await savePendingFund(pending("https://wallet.tempo.xyz/agent?action=fund"));

    await expectMode(pendingFundPath(), 0o600);
    await expectMode(dirname(pendingFundPath()), 0o700);
    expect(await loadPendingFund()).toEqual(pending("https://wallet.tempo.xyz/agent?action=fund"));
  });

  it.each([
    { name: "missing", contents: undefined },
    { name: "not JSON", contents: "{" },
    { name: "without balances", contents: JSON.stringify({ network: "mainnet", assets: [] }) },
  ])("reads a $name file as no funding", async ({ contents }) => {
    await useTempHome();
    if (contents !== undefined) await writeFile(pendingFundPath(), contents);

    expect(await loadPendingFund()).toBeUndefined();
  });

  it.each([
    { name: "any funding", clear: undefined, left: undefined },
    { name: "the saved funding", clear: "https://example.test/2", left: undefined },
    {
      name: "a funding it replaced",
      clear: "https://example.test/1",
      left: "https://example.test/2",
    },
  ])("clearing $name leaves $left", async ({ clear, left }) => {
    await useTempHome();
    await savePendingFund(pending("https://example.test/1"));
    await savePendingFund(pending("https://example.test/2"));

    await clearPendingFund(clear === undefined ? undefined : pending(clear));

    expect((await loadPendingFund())?.url).toBe(left);
  });
});

async function expectMode(path: string, mode: number) {
  if (process.platform === "win32") return;
  expect((await stat(path)).mode & 0o777).toBe(mode);
}
