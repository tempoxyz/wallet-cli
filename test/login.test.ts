import { stat } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logoutHandler, refreshHandler } from "../src/commands/identity.js";
import { loginHandler, loginStatusHandler } from "../src/commands/login.js";
import { settleWalletStore } from "../src/provider.js";
import { appUrl } from "../src/shared/network.js";
import {
  loadPendingLogin,
  loadWalletState,
  pendingLoginPath,
  saveWalletState,
} from "../src/wallet/store.js";
import { deviceCodeHost, type TokenAnswer } from "./device-code-host.js";
import { testWallet, testWallet2, useTempHome, walletState } from "./helpers.js";

const loginCta = (network: string) => ({
  commands: [{ command: `tempo wallet login --network ${network}` }],
});

let stderr: string[];

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void stderr.push(line));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Serves the wallet's device-code endpoints in-process, answering `/token` polls in order. */
function useHost(
  answers: readonly TokenAnswer[],
  options?: { expiresIn?: number; interval?: number },
) {
  const host = deviceCodeHost(
    (poll) => answers[Math.min(poll, answers.length) - 1] ?? "pending",
    options,
  );
  vi.stubGlobal("fetch", vi.fn(host.fetch));
  return host;
}

/** The access key the CLI asked the wallet to authorize in registration `index`. */
function registeredKey(host: ReturnType<typeof useHost>, index = 0) {
  return host.registrations[index]!.message.payload[0]!.params[0];
}

describe("login", () => {
  it("returns the code and URL for an agent without polling, and saves the login", async () => {
    await useTempHome();
    const host = useHost(["approve"], { interval: 5 });

    expect(await loginHandler({ network: "testnet", browser: false, wait: false })).toEqual({
      status: "pending",
      verification_url: `${appUrl}/api/auth/device/verify?user_code=ABCDEFG1`,
      user_code: "ABCD-EFG1",
      expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/),
      instruction: expect.stringContaining("ABCD-EFG1"),
      _next: {
        argv: ["tempo", "wallet", "login", "status", "--interval", "5", "--network", "testnet"],
        command: "tempo wallet login status --interval 5 --network testnet",
        until: '.status != "pending"',
        poll_interval_seconds: 5,
      },
    });
    expect(stderr).toEqual([
      "Device confirmation code: ABCD-EFG1",
      `Continue at: ${appUrl}/api/auth/device/verify?user_code=ABCDEFG1`,
    ]);
    expect(host.polls).toEqual([]);
    expect(registeredKey(host).chainId).toBe("0xa5bf");

    const pending = await loadPendingLogin();
    expect(pending).toMatchObject({
      network: "testnet",
      registration: { device_code: "device-1", user_code: "ABCDEFG1" },
      accessKey: {
        handle: { kind: "webcrypto-p256" },
        publicKey: registeredKey(host).capabilities.authorizeAccessKey.publicKey,
      },
    });
    expect(pending!.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(590);
    expect((await stat(pendingLoginPath())).mode & 0o777).toBe(0o600);
  });

  it.each([
    { advertised: 5, interval: 5 },
    { advertised: 12, interval: 12 },
    { advertised: 0.5, interval: 1 },
    // The SDK polls every five seconds when the wallet advertises no usable interval.
    { advertised: 0, interval: 5 },
    { advertised: -1, interval: 5 },
  ])(
    "points the continuation at a $interval second interval for an advertised $advertised",
    async ({ advertised, interval }) => {
      await useTempHome();
      useHost(["approve"], { interval: advertised });

      expect(await loginHandler({ network: "testnet", browser: false, wait: false })).toMatchObject(
        {
          _next: {
            command: `tempo wallet login status --interval ${interval} --network testnet`,
            poll_interval_seconds: interval,
          },
        },
      );
    },
  );

  it("waits for approval when asked to, and stores the account and key", async () => {
    await useTempHome();
    const host = useHost(["pending", "pending", "approve"]);

    expect(await loginHandler({ network: "testnet", browser: false, wait: true })).toEqual({
      accounts: [testWallet],
      chainId: 42431,
      instruction: "Run the next command to confirm the wallet is ready.",
      _next: {
        argv: ["tempo", "wallet", "whoami", "--network", "testnet"],
        command: "tempo wallet whoami --network testnet",
      },
    });
    expect(host.polls).toHaveLength(3);
    expect(stderr.at(-1)).toMatch(/^Waiting for approval; the code expires at \d{4}-.+Z\.$/);
    await expectLoggedIn(host, 42431);
  });

  it("replaces a pending login with a new code", async () => {
    await useTempHome();
    const host = useHost(["approve"]);

    await loginHandler({ network: "testnet", browser: false, wait: false });
    await loginHandler({ network: "testnet", browser: false, wait: false });

    expect((await loadPendingLogin())?.registration.device_code).toBe("device-2");
    expect(await loginStatusHandler({})).toMatchObject({ accounts: [testWallet] });
    expect(host.polls.map((poll) => poll.device_code)).toEqual(["device-2"]);
    await expectLoggedIn(host, 42431, 1);
  });

  it.each([true, false])("with browser=%s reuses a payment-capable key", async (browser) => {
    await useTempHome();
    await saveWalletState(walletState());
    const host = useHost(["approve"]);

    expect(await loginHandler({ network: "mainnet", browser, wait: false })).toMatchObject({
      wallet: testWallet.toLowerCase(),
      key: { chain_id: 4217 },
    });
    expect(host.registrations).toEqual([]);
  });

  it.each([
    { name: "expired", overrides: { expiry: 1 } },
    { name: "missing signing material", overrides: { privateKey: undefined } },
    { name: "another wallet", overrides: { access: testWallet2 } },
  ])("starts a new login instead of reusing a cached $name key", async ({ overrides }) => {
    await useTempHome();
    await saveWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }] }),
    );
    const host = useHost(["approve"]);

    expect(await loginHandler({ network: "mainnet", wait: false })).toMatchObject({
      status: "pending",
    });
    expect(host.registrations).toHaveLength(1);
  });
});

describe("login status", () => {
  it.each([
    {
      name: "approval",
      answers: ["pending", "pending", "approve"],
      options: {},
      polls: 3,
      result: {
        accounts: [testWallet],
        chainId: 42431,
        _next: { command: "tempo wallet whoami --network testnet" },
      },
      kept: false,
    },
    {
      name: "denial",
      answers: ["pending", "deny"],
      options: {},
      polls: 2,
      result: { code: "E_LOGIN_DENIED", exitCode: 4, retryable: false, cta: loginCta("testnet") },
      kept: false,
    },
    {
      name: "expiry",
      answers: ["pending", "expire"],
      options: {},
      polls: 2,
      result: { code: "E_LOGIN_EXPIRED", exitCode: 4, retryable: false, cta: loginCta("testnet") },
      kept: false,
    },
    {
      name: "running out of attempts",
      answers: ["pending", "slow_down"],
      options: { maxAttempts: 2 },
      polls: 2,
      result: {
        code: "E_POLL_TIMEOUT",
        exitCode: 3,
        retryable: true,
        message: expect.stringContaining("still waiting for approval"),
        cta: {
          commands: [{ command: "tempo wallet login status --max-attempts 2 --network testnet" }],
        },
      },
      kept: true,
    },
    {
      name: "an HTTP failure",
      answers: ["pending", "unavailable"],
      options: {},
      polls: 2,
      result: {
        code: "E_NETWORK",
        exitCode: 3,
        retryable: true,
        cta: { commands: [{ command: "tempo wallet login status --network testnet" }] },
      },
      kept: true,
    },
  ] as const)("ends on $name", async ({ answers, options, polls, result, kept }) => {
    await useTempHome();
    const host = useHost(answers);
    await loginHandler({ network: "testnet", browser: false, wait: false });

    expect(await loginStatusHandler(options)).toMatchObject(result);
    expect(host.polls).toHaveLength(polls);
    expect(Boolean(await loadPendingLogin())).toBe(kept);
  });

  it.each(["deny", "expire"] as const)(
    "lets a login start over after a wallet answers %s",
    async (answer) => {
      await useTempHome();
      await saveWalletState(walletState());
      const host = useHost([answer]);

      for (const _ of [1, 2]) {
        await loginHandler({ network: "testnet", browser: false, wait: false });
        expect(await loginStatusHandler({})).toMatchObject({ code: expect.any(String) });
      }

      expect(host.polls.map((poll) => poll.device_code)).toEqual(["device-1", "device-2"]);
      const state = await loadWalletState();
      expect(state.chainId).toBe(4217);
      expect(state.accessKeys.map((key) => key.chainId)).toEqual([4217]);
    },
  );

  it("fails a network error as retryable and keeps the login", async () => {
    await useTempHome();
    useHost(["pending"]);
    await loginHandler({ network: "testnet", browser: false, wait: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    expect(await loginStatusHandler({ interval: 5 })).toMatchObject({
      code: "E_NETWORK",
      retryable: true,
      cta: { commands: [{ command: "tempo wallet login status --interval 5 --network testnet" }] },
    });
    expect(await loadPendingLogin()).toBeDefined();
  });

  it.each([
    {
      name: "a new login",
      replace: () => loginHandler({ network: "mainnet", browser: false, wait: false }),
      message:
        "A newer login replaced this one. Run 'tempo wallet login status --network mainnet' to finish it.",
      cta: { commands: [{ command: "tempo wallet login status --network mainnet" }] },
      left: "device-2",
    },
    {
      name: "logout",
      replace: () => logoutHandler(),
      message:
        "The login was cancelled by logout. Run 'tempo wallet login --network testnet' to start a new one.",
      cta: loginCta("testnet"),
      left: undefined,
    },
  ])(
    "drops an approval that arrives after $name, keeping what replaced it",
    async ({ replace, message, cta, left }) => {
      await useTempHome();
      let approved = false;
      const host = deviceCodeHost(() => (approved ? "approve" : "pending"));
      vi.stubGlobal("fetch", vi.fn(host.fetch));
      await loginHandler({ network: "testnet", browser: false, wait: false });

      const status = loginStatusHandler({});
      await vi.waitFor(() => expect(host.polls.length).toBeGreaterThan(0));
      await replace();
      approved = true;

      expect(await status).toEqual({
        code: "E_USAGE",
        message,
        exitCode: 2,
        retryable: false,
        cta,
      });
      expect(host.polls.at(-1)?.device_code).toBe("device-1");
      expect((await loadWalletState()).accounts).toEqual([]);
      expect((await loadPendingLogin())?.registration.device_code).toBe(left);
    },
  );

  it("lets logout cancel a login that has not been polled yet", async () => {
    await useTempHome();
    const host = useHost(["approve"]);
    await loginHandler({ network: "testnet", browser: false, wait: false });
    await logoutHandler();

    expect(await loginStatusHandler({ network: "testnet" })).toMatchObject({
      code: "E_USAGE",
      cta: loginCta("testnet"),
    });
    expect(host.polls).toEqual([]);
    expect((await loadWalletState()).accounts).toEqual([]);
  });

  it("ends a login whose code has expired without polling", async () => {
    await useTempHome();
    const host = useHost(["approve"], { expiresIn: 0 });
    await loginHandler({ network: "mainnet", browser: false, wait: false });

    expect(await loginStatusHandler({})).toMatchObject({
      code: "E_LOGIN_EXPIRED",
      cta: loginCta("mainnet"),
    });
    expect(host.polls).toEqual([]);
    expect(await loadPendingLogin()).toBeUndefined();
  });

  it.each([
    { name: "no login", network: undefined, pending: undefined, expected: "mainnet" },
    {
      name: "a login on another network",
      network: "mainnet",
      pending: "testnet",
      expected: "mainnet",
    },
    {
      name: "no login on the requested network",
      network: "testnet",
      pending: undefined,
      expected: "testnet",
    },
  ] as const)(
    "points at login when there is $name pending",
    async ({ network, pending, expected }) => {
      await useTempHome();
      const host = useHost(["approve"]);
      if (pending) await loginHandler({ network: pending, browser: false, wait: false });

      expect(await loginStatusHandler({ network })).toEqual({
        code: "E_USAGE",
        message: `No login is pending on ${expected}. Run 'tempo wallet login --network ${expected}' to start one.`,
        exitCode: 2,
        retryable: false,
        cta: loginCta(expected),
      });
      expect(host.polls).toEqual([]);
    },
  );

  // #149: the wallet approved the code, but its `/token` kept answering `authorization_pending`
  // from a stale store copy, and the CLI stopped after the SDK's fixed five minutes with
  // `code: UNKNOWN` and nothing to resume.
  it("finishes an approval that reaches /token late, from a later process", async () => {
    await useTempHome();
    const host = useHost(["pending", "pending", "pending", "approve"]);
    await loginHandler({ network: "testnet", browser: false, wait: false });

    expect(await loginStatusHandler({ maxAttempts: 2 })).toMatchObject({
      code: "E_POLL_TIMEOUT",
      retryable: true,
    });
    expect(await loginStatusHandler({})).toMatchObject({ accounts: [testWallet] });
    expect(host.polls).toHaveLength(4);
    await expectLoggedIn(host, 42431);
  });

  it("waits until the code expires rather than the SDK's five minutes, then reports it", async () => {
    await useTempHome();
    await saveWalletState(walletState());
    const host = useHost(["pending"], { expiresIn: 2 });
    await loginHandler({ network: "testnet", browser: false, wait: false });

    expect(await loginStatusHandler({})).toMatchObject({
      code: "E_LOGIN_EXPIRED",
      cta: loginCta("testnet"),
    });
    expect(host.polls.length).toBeGreaterThan(1);
    expect(await loadPendingLogin()).toBeUndefined();
    // The SDK's timeout leaves the wallet on its network.
    expect((await loadWalletState()).chainId).toBe(4217);
  });
});

describe("stored network", () => {
  // Logged in on mainnet, with a key a mainnet login does not reuse.
  const onMainnet = walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, expiry: 1 }] });
  const flows = [
    {
      flow: "login",
      run: (network: string) => loginHandler({ network, browser: false, wait: true }),
    },
    {
      flow: "login, then login status",
      run: async (network: string) => {
        await loginHandler({ network, browser: false, wait: false });
        // A pending login leaves the network as it was.
        expect((await loadWalletState()).chainId).toBe(4217);
        return await loginStatusHandler({});
      },
    },
    {
      flow: "refresh",
      run: (network: string) =>
        refreshHandler({ network, browser: false }).catch((error: unknown) => error),
    },
  ];

  // Only an approval moves the wallet to the login's network.
  const answers = [
    { network: "testnet", answer: "approve", chainId: 42431 },
    { network: "testnet", answer: "deny", chainId: 4217 },
    { network: "testnet", answer: "expire", chainId: 4217 },
    { network: "testnet", answer: "unavailable", chainId: 4217 },
    { network: "mainnet", answer: "approve", chainId: 4217 },
    { network: "mainnet", answer: "deny", chainId: 4217 },
  ] as const;

  it.each(
    flows.flatMap(({ flow, run }) => answers.map((scenario) => ({ flow, run, ...scenario }))),
  )(
    "$flow on $network leaves chain $chainId when the wallet answers $answer",
    async ({ run, network, answer, chainId }) => {
      await useTempHome();
      await saveWalletState(onMainnet);
      const host = useHost([answer]);

      await run(network);

      expect(host.polls).toHaveLength(1);
      const state = await loadWalletState();
      expect(state.chainId).toBe(chainId);
      expect(state.accounts).toEqual([{ address: testWallet }]);
    },
  );

  it.each(flows)(
    "$flow on testnet leaves a store another login changed before the wallet denied it",
    async ({ run }) => {
      await useTempHome();
      await saveWalletState(onMainnet);
      // Another process logs in on testnet while this login waits for the wallet, after the
      // SDK saved this login's network.
      const other = walletState({
        accessKeys: [{ ...walletState().accessKeys[0]!, chainId: 42431 }],
        chainId: 42431,
      });
      const host = deviceCodeHost(() => "deny");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("/token")) {
            await settleWalletStore();
            await saveWalletState(other);
          }
          return await host.fetch(input, init);
        }),
      );

      await run("testnet");

      expect(host.polls).toHaveLength(1);
      expect(await loadWalletState()).toMatchObject({
        chainId: 42431,
        accessKeys: [expect.objectContaining({ chainId: 42431 })],
      });
    },
  );
});

/** The wallet store holds the account and the access key registration `index` asked for. */
async function expectLoggedIn(host: ReturnType<typeof useHost>, chainId: number, index = 0) {
  const state = await loadWalletState();
  expect(state).toMatchObject({ accounts: [{ address: testWallet }], chainId });
  expect(state.accessKeys).toEqual([
    expect.objectContaining({
      address: registeredKey(host, index).capabilities.authorizeAccessKey.address,
      access: testWallet,
      chainId,
      keyType: "p256",
      handle: expect.objectContaining({ kind: "webcrypto-p256" }),
    }),
  ]);
  expect(await loadPendingLogin()).toBeUndefined();
}
