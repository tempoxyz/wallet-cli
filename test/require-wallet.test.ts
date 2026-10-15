import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/wallet/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/wallet/store.js")>();
  return { ...actual, loadWalletState: vi.fn(actual.loadWalletState) };
});

import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { withWallet } from "../src/shared/require-wallet.js";
import { loadWalletState, type WalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const key = walletState().accessKeys[0]!;
const testnetKey = { ...key, address: testAccessKey2, privateKey: testPrivateKey2, chainId: 42431 };
const expiredKey = { ...key, expiry: 1 };

const notReady: {
  name: string;
  state: WalletState;
  network?: string;
  code: string;
  message: string;
  command: string;
}[] = [
  {
    name: "no account",
    state: walletState({ accounts: [] }),
    code: "E_NOT_AUTHENTICATED",
    message: "No wallet is logged in.",
    command: "tempo wallet login --network mainnet",
  },
  {
    name: "no account with --network testnet",
    state: walletState({ accounts: [] }),
    network: "testnet",
    code: "E_NOT_AUTHENTICATED",
    message: "No wallet is logged in.",
    command: "tempo wallet login --network testnet",
  },
  {
    name: "an expired key",
    state: walletState({ accessKeys: [expiredKey] }),
    code: "E_KEY_EXPIRED",
    message: "The access key for this wallet on mainnet has expired.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "an expired key on the logged-in testnet chain",
    state: walletState({ chainId: 42431, accessKeys: [{ ...testnetKey, expiry: 1 }] }),
    code: "E_KEY_EXPIRED",
    message: "The access key for this wallet on testnet has expired.",
    command: "tempo wallet refresh --network testnet",
  },
  {
    name: "a key for another chain only",
    state: walletState(),
    network: "testnet",
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on testnet.",
    command: "tempo wallet refresh --network testnet",
  },
  {
    name: "no keys",
    state: walletState({ accessKeys: [] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "a key without signing material",
    state: walletState({ accessKeys: [{ ...key, privateKey: undefined }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "another wallet's key only",
    state: walletState({ accessKeys: [{ ...key, access: testWallet2 }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    message: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
];

const ready: {
  name: string;
  state: WalletState;
  network?: string;
  expected: { network: { name: string; chainId: number }; key: string };
}[] = [
  {
    name: "a usable key",
    state: walletState(),
    expected: { network: { name: "mainnet", chainId: 4217 }, key: testAccessKey },
  },
  {
    name: "a usable key after an expired one",
    state: walletState({ accessKeys: [expiredKey, { ...key, address: testAccessKey2 }] }),
    expected: { network: { name: "mainnet", chainId: 4217 }, key: testAccessKey2 },
  },
  {
    name: "a usable key on the --network chain",
    state: walletState({ accessKeys: [expiredKey, testnetKey] }),
    network: "testnet",
    expected: { network: { name: "testnet", chainId: 42431 }, key: testAccessKey2 },
  },
];

function runContext(network: string | undefined, agent = true) {
  const error = vi.fn((value: unknown) => value);
  return { error, context: { agent, globals: { network }, error: error as never } };
}

describe("withWallet", () => {
  it.each(notReady)(
    "returns $code for $name without running the command",
    async ({ state, network, code, message, command }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
      await writeWalletState(state);
      const handler = vi.fn();
      const { context, error } = runContext(network);

      const result = await withWallet(handler)(context);

      const expected = {
        code,
        message: `${message} Run '${command}' before retrying.`,
        exitCode: 4,
        retryable: false,
        cta: { commands: [{ command }] },
      };
      expect(result).toEqual(expected);
      expect(error).toHaveBeenCalledExactlyOnceWith(expected);
      expect(handler).not.toHaveBeenCalled();
      expect(loadWalletState).toHaveBeenCalledOnce();
    },
  );

  it.each(ready)("runs the command with $name", async ({ state, network, expected }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
    await writeWalletState(state);
    const handler = vi.fn(async () => "done");
    const { context, error } = runContext(network);

    expect(await withWallet(handler)(context)).toBe("done");

    expect(error).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledExactlyOnceWith(context, {
      state: expect.objectContaining({ accounts: [{ address: testWallet }] }),
      network: expected.network,
      account: { address: testWallet },
      key: expect.objectContaining({ address: expected.key, chainId: expected.network.chainId }),
    });
    expect(loadWalletState).toHaveBeenCalledOnce();
  });

  const loggedOut = { name: "logged out", state: walletState({ accounts: [] }) };
  const expired = { name: "an expired key", state: walletState({ accessKeys: [expiredKey] }) };
  const unusable = {
    name: "a key without signing material",
    state: walletState({ accessKeys: [{ ...key, privateKey: undefined }] }),
  };
  const noKeys = { name: "no keys", state: walletState({ accessKeys: [] }) };
  it.each([
    { requireKey: "agent", agent: true, ...loggedOut, result: "E_NOT_AUTHENTICATED" },
    { requireKey: "agent", agent: false, ...loggedOut, result: "E_NOT_AUTHENTICATED" },
    { requireKey: "never", agent: false, ...loggedOut, result: "E_NOT_AUTHENTICATED" },
    { requireKey: "always", agent: false, ...expired, result: "E_KEY_EXPIRED" },
    { requireKey: "agent", agent: true, ...expired, result: "E_KEY_EXPIRED" },
    { requireKey: "agent", agent: true, ...unusable, result: "E_AUTH_REFRESH_REQUIRED" },
    { requireKey: "agent", agent: false, ...expired, result: "run" },
    { requireKey: "agent", agent: false, ...unusable, result: "run" },
    { requireKey: "never", agent: true, ...expired, result: "run" },
    { requireKey: "never", agent: true, ...unusable, result: "run" },
    { requireKey: "never", agent: true, ...noKeys, result: "run" },
  ] as const)(
    "requireKey $requireKey with agent $agent and $name: $result",
    async ({ requireKey, agent, state, result }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
      await writeWalletState(state);
      const handler = vi.fn(async () => "done");
      const { context } = runContext(undefined, agent);

      const output = await withWallet(handler, { requireKey })(context);

      if (result !== "run") {
        expect(output).toMatchObject({ code: result, exitCode: 4 });
        expect(handler).not.toHaveBeenCalled();
        return;
      }
      expect(output).toBe("done");
      expect(handler).toHaveBeenCalledExactlyOnceWith(context, {
        state: expect.objectContaining({ accounts: [{ address: testWallet }] }),
        network: { name: "mainnet", chainId: 4217 },
        account: { address: testWallet },
        key: undefined,
      });
    },
  );

  // `refuse` runs after the login check and before the key check, so its remedy wins over a key's.
  const refusal = {
    code: "E_USAGE" as const,
    message: "Refused.",
    exitCode: 2,
    retryable: false,
    cta: { commands: [{ command: "tempo wallet login --network testnet" }] },
  };
  const usable = { name: "a usable key", state: walletState() };
  it.each([
    { refuses: true, ...loggedOut, result: "E_NOT_AUTHENTICATED", refuseCalled: false },
    { refuses: true, ...expired, result: "E_USAGE", refuseCalled: true },
    { refuses: true, ...usable, result: "E_USAGE", refuseCalled: true },
    { refuses: false, ...expired, result: "E_KEY_EXPIRED", refuseCalled: true },
    { refuses: false, ...usable, result: "run", refuseCalled: true },
  ] as const)(
    "refuse that refuses: $refuses with $name: $result",
    async ({ refuses, state, result, refuseCalled }) => {
      await useTempHome();
      vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
      await writeWalletState(state);
      const handler = vi.fn(async () => "done");
      const refuse = vi.fn(() => (refuses ? refusal : undefined));
      const { context, error } = runContext(undefined, true);

      const output = await withWallet(handler, { requireKey: "agent", refuse })(context);

      expect(refuse).toHaveBeenCalledTimes(refuseCalled ? 1 : 0);
      if (result === "run") {
        expect(output).toBe("done");
        expect(handler).toHaveBeenCalledOnce();
        return;
      }
      expect(output).toMatchObject(result === "E_USAGE" ? refusal : { code: result });
      expect(error).toHaveBeenCalledOnce();
      expect(handler).not.toHaveBeenCalled();
    },
  );
});

const recipient = "0x1111111111111111111111111111111111111111";
const machChallenge = `Payment realm="example", method="tempo", intent="charge", id="abc123", expires="2099-01-01T00:00:00Z", request="${Buffer.from(
  JSON.stringify({
    amount: "1000000",
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217, machineTokenEnabled: true },
  }),
).toString("base64url")}"`;

// Payments sign with the local access key, so agent runs need a usable one.
const keyCommands = [
  { command: "transfer", argv: ["transfer", "1", usdcToken, recipient, "--dry-run"] },
  {
    command: "transfer --mach",
    argv: ["transfer", "--mach", "--max-spend", "1", "--mpp-challenge", machChallenge, "--dry-run"],
  },
  { command: "swap", argv: ["swap", "1", usdcToken, moderatoToken, "--dry-run"] },
];

// The wallet app approves these, so they need only the logged-in account. `ran` is what each
// does once past the check.
const walletAppCommands = [
  {
    command: "keys update",
    argv: ["keys", "update", testAccessKey, "--limit", "1", "--no-browser"],
    ran: { code: 1, request: "POST /api/auth/device/register" },
  },
  {
    command: "revoke --dry-run",
    argv: ["revoke", testAccessKey, "--dry-run"],
    ran: { code: 0, stdout: { status: "dry_run", access_key: testAccessKey.toLowerCase() } },
  },
  // The store holds only the wallet address, so a revocation the CLI signed itself would fail
  // before asking the wallet app.
  {
    command: "revoke --yes",
    argv: ["revoke", testAccessKey, "--yes", "--no-browser"],
    ran: { code: 1, request: "POST /api/auth/device/register" },
  },
  {
    command: "sessions close",
    argv: ["sessions", "close", "https://service.example"],
    ran: { code: 1, stdout: { failed: 1, results: [{ error: "no active session" }] } },
  },
  {
    command: "sessions close --dry-run",
    argv: ["sessions", "close", "https://service.example", "--dry-run"],
    ran: { code: 0, stdout: { targets: [{ state: "not found" }] } },
  },
  {
    command: "sessions close --finalize",
    argv: ["sessions", "close", "--finalize"],
    ran: { code: 1, request: "POST /" },
  },
];

// Each state selects testnet a different way, so the cta must carry the network the CLI resolved.
const gatedStates = [
  {
    name: "no account",
    state: walletState({ accounts: [] }),
    flags: ["-n", "testnet"],
    code: "E_NOT_AUTHENTICATED",
    cta: "tempo wallet login --network testnet",
  },
  {
    name: "an expired key",
    state: walletState({ chainId: 42431, accessKeys: [{ ...testnetKey, expiry: 1 }] }),
    code: "E_KEY_EXPIRED",
    cta: "tempo wallet refresh --network testnet",
  },
  {
    name: "no key for the chain",
    state: walletState(),
    env: { TEMPO_WALLET_NETWORK: "testnet" },
    code: "E_AUTH_REFRESH_REQUIRED",
    cta: "tempo wallet refresh --network testnet",
  },
];

describe("wallet CLI login and access key checks", () => {
  // Any RPC or wallet-approval request means the command ran past the check.
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.statusCode = 500;
    response.end();
  });
  let origin = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(
    gatedStates.flatMap((state) =>
      [...keyCommands, ...(state.code === "E_NOT_AUTHENTICATED" ? walletAppCommands : [])].map(
        (gated) => ({ ...state, ...gated }),
      ),
    ),
  )(
    "$command with $name returns $code",
    async ({ argv, state, flags = [], env = {}, code, cta }) => {
      const home = await useTempHome();
      await writeWalletState(state);
      requests.length = 0;

      const result = await wallet([...argv, ...flags], {
        HOME: home,
        TEMPO_AUTH_URL: origin,
        TEMPO_RPC_URL: origin,
        ...env,
      });

      expect(result.code).toBe(4);
      expect(JSON.parse(result.stdout)).toEqual({
        code,
        message: expect.stringContaining(`Run '${cta}'`),
        retryable: false,
        cta: { description: "Suggested command:", commands: [{ command: cta }] },
      });
      expect(result.stderr).toBe("");
      expect(requests).toEqual([]);
    },
  );

  it.each([
    {
      name: "--credits, which the wallet app signs",
      state: walletState({ accessKeys: [expiredKey] }),
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient, "--dry-run"],
      env: {},
    },
    {
      name: "--mach paid by TEMPO_PRIVATE_KEY",
      state: walletState({ accounts: [] }),
      argv: [
        "transfer",
        "--mach",
        "--max-spend",
        "1",
        "--mpp-challenge",
        machChallenge,
        "--dry-run",
      ],
      env: { TEMPO_PRIVATE_KEY: testPrivateKey2 },
    },
  ])("does not require a usable key for transfer $name", async ({ state, argv, env }) => {
    const home = await useTempHome();
    await writeWalletState(state);

    const result = await wallet(argv, { HOME: home, ...env });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dry_run: true });
  });

  const keyProblems = [
    { name: "an expired key", state: walletState({ accessKeys: [expiredKey] }) },
    {
      name: "a key without signing material",
      state: walletState({ accessKeys: [{ ...key, privateKey: undefined }] }),
    },
  ];

  it.each(
    keyProblems.flatMap((state) => walletAppCommands.map((command) => ({ ...state, ...command }))),
  )("$command with $name runs past the check", async ({ argv, state, ran }) => {
    const home = await useTempHome();
    await writeWalletState(state);
    requests.length = 0;

    const result = await wallet(argv, {
      HOME: home,
      TEMPO_AUTH_URL: origin,
      TEMPO_RPC_URL: origin,
    });

    expect(result.code).toBe(ran.code);
    if ("stdout" in ran) expect(JSON.parse(result.stdout)).toMatchObject(ran.stdout);
    if ("request" in ran) expect(requests).toContain(ran.request);
  });

  // Interactive runs fall back to approving in the wallet app; agent runs above fail fast.
  it.each([
    {
      command: "transfer",
      argv: ["transfer", "1", usdcToken, recipient, "--dry-run"],
      ran: { code: 0 },
    },
    // The quote's first RPC call means the swap ran past the check.
    {
      command: "swap",
      argv: ["swap", "1", usdcToken, moderatoToken, "--dry-run"],
      ran: { code: 1, request: "POST /" },
    },
  ])("interactive $command with an expired key runs past the check", async ({ argv, ran }) => {
    const home = await useTempHome();
    await writeWalletState(walletState({ accessKeys: [expiredKey] }));
    requests.length = 0;

    const result = await wallet(argv, { HOME: home, TEMPO_RPC_URL: origin }, { interactive: true });

    expect(result.code).toBe(ran.code);
    expect(result.stdout).not.toContain("E_KEY_EXPIRED");
    if ("request" in ran) expect(requests).toContain(ran.request);
  });

  // Wallet-app approval, the provider's fallback whenever no key can sign, is on the chain the
  // wallet is logged in on, so a swap or token transfer needs a login on the selected network
  // before it reads a quote or token, prompts, or sends anything, even with a key there.
  it.each(
    [
      {
        name: "without a key there",
        network: "testnet",
        state: walletState({ accessKeys: [expiredKey] }),
        interactive: true,
      },
      {
        name: "without a key there",
        network: "mainnet",
        state: walletState({ chainId: 42431, accessKeys: [{ ...testnetKey, expiry: 1 }] }),
        interactive: true,
      },
      {
        name: "with a key there",
        network: "testnet",
        state: walletState({ accessKeys: [key, testnetKey] }),
        interactive: false,
      },
      {
        name: "with a key there",
        network: "mainnet",
        state: walletState({ chainId: 42431, accessKeys: [key, testnetKey] }),
        interactive: false,
      },
    ].flatMap((row) => [
      { ...row, command: "swap", argv: ["swap", "1", "pathUSD", "USDC.e"] },
      { ...row, command: "transfer", argv: ["transfer", "1", "pathUSD", recipient] },
    ]),
  )(
    "$command --network $network $name over another login returns a login cta (interactive: $interactive)",
    async ({ command: name, argv, network, state, interactive }) => {
      const home = await useTempHome();
      await writeWalletState(state);
      requests.length = 0;

      // An interactive run answers yes to any prompt instead of passing --yes.
      const result = await wallet(
        [...argv, "--network", network, ...(interactive ? [] : ["--yes"])],
        { HOME: home, TEMPO_AUTH_URL: origin, TEMPO_RPC_URL: origin },
        { interactive, input: "y\n" },
      );

      const command = `tempo wallet login --network ${network}`;
      expect(result.code).toBe(2);
      if (interactive) {
        expect(result.stdout).toContain("E_USAGE");
        expect(result.stdout).toContain(`then rerun the ${name}.`);
        expect(result.stdout).toContain(`Suggested command:\n  ${command}`);
        expect(result.stderr).not.toContain("[y/N]");
      } else
        expect(JSON.parse(result.stdout)).toEqual({
          code: "E_USAGE",
          message: expect.stringContaining(`log in with '${command}', then rerun the ${name}.`),
          retryable: false,
          cta: { description: "Suggested command:", commands: [{ command }] },
        });
      expect(requests).toEqual([]);
    },
  );

  // A key there would not let a transfer on another network through, so an agent run gets the
  // login it needs rather than a refresh for that key.
  it.each([
    { network: "testnet", state: walletState({ accessKeys: [key] }) },
    { network: "mainnet", state: walletState({ chainId: 42431, accessKeys: [testnetKey] }) },
  ])(
    "agent transfer --network $network without a key there over another login returns a login cta",
    async ({ network, state }) => {
      const home = await useTempHome();
      await writeWalletState(state);
      requests.length = 0;

      const result = await wallet(
        ["transfer", "1", "pathUSD", recipient, "--network", network, "--yes"],
        { HOME: home, TEMPO_AUTH_URL: origin, TEMPO_RPC_URL: origin },
      );

      const command = `tempo wallet login --network ${network}`;
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual({
        code: "E_USAGE",
        message: expect.stringContaining(`log in with '${command}', then rerun the transfer.`),
        retryable: false,
        cta: { description: "Suggested command:", commands: [{ command }] },
      });
      expect(requests).toEqual([]);
    },
  );

  it.each(keyCommands)(
    "interactive $command with no account returns E_NOT_AUTHENTICATED",
    async ({ argv }) => {
      const home = await useTempHome();
      await writeWalletState(walletState({ accounts: [] }));
      requests.length = 0;

      const result = await wallet(
        argv,
        { HOME: home, TEMPO_RPC_URL: origin },
        { interactive: true },
      );

      expect(result.code).toBe(4);
      expect(result.stdout).toContain("E_NOT_AUTHENTICATED");
      expect(requests).toEqual([]);
    },
  );

  it("revoke run by an agent without --yes returns E_USAGE with a --yes cta", async () => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    requests.length = 0;

    const result = await wallet(["revoke", testAccessKey], {
      HOME: home,
      TEMPO_AUTH_URL: origin,
      TEMPO_RPC_URL: origin,
    });

    const command = `tempo wallet revoke ${testAccessKey.toLowerCase()} --yes --network mainnet`;
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "E_USAGE",
      message: `Revocation cannot be undone, so it needs confirmation. Review the key with --dry-run, then run '${command}'.`,
      retryable: false,
      cta: { description: "Suggested command:", commands: [{ command }] },
    });
    expect(requests).toEqual([]);
  });

  it.each([
    { answer: "y", code: 1, asked: true },
    { answer: "n", code: 2, asked: false },
    { answer: "", code: 2, asked: false },
  ])(
    "interactive revoke answered '$answer' asks the wallet app: $asked",
    async ({ answer, code, asked }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      requests.length = 0;

      const result = await wallet(
        ["revoke", testAccessKey, "--no-browser"],
        { HOME: home, TEMPO_AUTH_URL: origin, TEMPO_RPC_URL: origin },
        { interactive: true, input: answer ? `${answer}\n` : "" },
      );

      expect(result.code).toBe(code);
      expect(result.stderr).toContain(
        `Revoke access key ${testAccessKey.toLowerCase()} for wallet ${testWallet.toLowerCase()} on mainnet? This cannot be undone. [y/N]`,
      );
      expect(requests).toEqual(asked ? ["POST /api/auth/device/register"] : []);
    },
  );

  // Piped input is not a person answering, even when output goes to a terminal.
  it("revoke with piped stdin ignores the input and returns E_USAGE with a --yes cta", async () => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    requests.length = 0;

    const result = await wallet(
      ["revoke", testAccessKey, "--no-browser"],
      { HOME: home, TEMPO_AUTH_URL: origin, TEMPO_RPC_URL: origin },
      { interactive: true, pipedStdin: true, input: "y\n" },
    );

    const command = `tempo wallet revoke ${testAccessKey.toLowerCase()} --yes --no-browser --network mainnet`;
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain("[y/N]");
    expect(result.stdout).toContain(`then run '${command}'.`);
    expect(requests).toEqual([]);
  });

  it.each([
    { command: "refresh", argv: ["refresh", "--no-browser"] },
    { command: "keys update", argv: ["keys", "update", "--limit", "1", "--no-browser"] },
    { command: "revoke", argv: ["revoke", testAccessKey, "--yes", "--no-browser"] },
  ])("$command accepts --no-browser and asks the wallet app", async ({ argv }) => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    requests.length = 0;

    const result = await wallet(argv, {
      HOME: home,
      TEMPO_AUTH_URL: origin,
      TEMPO_RPC_URL: origin,
    });

    expect(result.code).toBe(1);
    // Each wallet-app request is sent once, even when it fails.
    expect(requests).toEqual(["POST /api/auth/device/register"]);
  });
});

const fixtures = join(import.meta.dirname, "fixtures");

/**
 * Runs the wallet CLI as an agent (`--format json`), or with `interactive` as a terminal user,
 * whose stdin is a terminal too unless `pipedStdin`; `input` is written to its stdin.
 */
function wallet(
  args: string[],
  env: Record<string, string>,
  {
    interactive = false,
    pipedStdin = false,
    input,
  }: { interactive?: boolean; pipedStdin?: boolean; input?: string } = {},
) {
  const fixture = join(
    fixtures,
    pipedStdin ? "interactive-stdout.mjs" : "interactive-terminal.mjs",
  );
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...env };
  for (const name of ["TEMPO_PRIVATE_KEY", "TEMPO_WALLET_NETWORK"])
    if (!(name in env)) delete childEnv[name];
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      interactive
        ? ["--import", fixture, cliBundle("wallet"), ...args]
        : [cliBundle("wallet"), ...args, "--format", "json"],
      { env: childEnv, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
