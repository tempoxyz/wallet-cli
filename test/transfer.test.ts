import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";

import { encodeFunctionData, erc20Abi, toHex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMetadata: vi.fn(
    async (
      _client: unknown,
      _parameters: { token: string },
    ): Promise<{ decimals: number; symbol: string }> => {
      throw new Error("no metadata");
    },
  ),
  // The provider holds every wallet it is asked for unless a test says otherwise.
  getAccount: vi.fn(({ address }: { address: string }) => ({ address })),
  request: vi.fn(async (_request: { method: string; params: unknown[] }) => ({
    transactionHash: `0x${"ab".repeat(32)}`,
  })),
}));

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getMetadata: mocks.getMetadata },
    },
  };
});

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  // Like the real provider, it loads the wallet store's chain when it is created.
  createProvider: vi.fn(async () => {
    const { loadWalletState } = await import("../src/wallet/store.js");
    const { chainId = 4217 } = await loadWalletState();
    return {
      getAccount: mocks.getAccount,
      getClient: () => ({}),
      request: mocks.request,
      store: { getState: () => ({ chainId }) },
    };
  }),
}));

import { transferTokens } from "../src/commands/transfer/tokens.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { parseNetwork } from "../src/shared/network.js";
import { shellQuote } from "../src/shared/next.js";
import { cliBundle } from "./cli-bundle.js";
import {
  containsSymbol,
  expectTokenError,
  expectUsageError,
  invalidTokenInputs,
  readyWallet,
  testWallet,
  testWallet2,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";
const usage = "usage: tempo wallet send <amount> <token> <to>";
const amountError = "Invalid amount: expected a positive decimal with at most 6 decimals";
const txHash = `0x${"ab".repeat(32)}`;
const notReviewed = "Transfer not sent: review it with --dry-run, then pass --yes";
const declined = "Transfer not sent: not confirmed at the prompt";
const fixtures = join(import.meta.dirname, "fixtures");

/** Lookups that report a 5 USDC.e balance, a 0.000175 fee, and no default fee token. */
function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: vi.fn(async () => 5_000_000n),
    estimateFee: vi.fn(async () => 175n),
    getUserFeeToken: vi.fn(async (): Promise<`0x${string}` | null> => null),
    confirm: vi.fn(async () => true),
    submit: vi.fn(async () => txHash),
    ...overrides,
  };
}

const unavailable = () => vi.fn(async () => Promise.reject(new Error("RPC unavailable")));

describe("transferTokens", () => {
  it.each([
    [{ token: usdcToken, to: recipient }, `missing <amount>; ${usage}`],
    [{ amount: "1", to: recipient }, `missing <token>; ${usage}`],
    [{ amount: "1", token: usdcToken }, `missing <to>; ${usage}`],
    [{ to: recipient }, `missing <amount>, <token>; ${usage}`],
    [{ token: usdcToken }, `missing <amount>, <to>; ${usage}`],
    [{ amount: "1" }, `missing <token>, <to>; ${usage}`],
    [{}, `missing <amount>, <token>, <to>; ${usage}`],
    [
      { amount: "1", token: "0x1234", to: recipient },
      "Invalid token address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x1234" },
      "Invalid recipient address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x70997970C51812dc3A010C7d01b50e0d17dc79c8" },
      "Invalid recipient address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x0000000000000000000000000000000000000000" },
      "Invalid recipient address: cannot transfer to the zero address",
    ],
  ])("rejects invalid input %j in dry runs and sends alike", async (args, message) => {
    await useTempHome();
    await writeWalletState(walletState());
    const wallet = await readyWallet();

    for (const dryRun of [true, false]) {
      const error = await transferTokens(wallet, { args, options: { "dry-run": dryRun } }).catch(
        (err: unknown) => err,
      );
      expectUsageError(error, message);
    }
  });

  it.each(["", "-1", "0", "0.000000", "1.1234567", "abc", "1e3", "0x10", " 1", "1."])(
    "rejects amount %j",
    async (amount) => {
      await useTempHome();
      await writeWalletState(walletState());

      for (const dryRun of [true, false]) {
        const error = await transferTokens(await readyWallet(), {
          args: { amount, token: usdcToken, to: recipient },
          options: { "dry-run": dryRun },
        }).catch((err: unknown) => err);
        expectUsageError(error, amountError);
      }
    },
  );

  it.each(["1", "0.000001", "1.123456", "1000000"])(
    "accepts amount %s in dry-run",
    async (amount) => {
      await useTempHome();
      await writeWalletState(walletState());

      const result = await transferTokens(
        await readyWallet(),
        { args: { amount, token: usdcToken, to: testWallet2 }, options: { "dry-run": true } },
        dependencies(),
      );

      expect(result).toMatchObject({ status: "dry_run", amount, to: testWallet2.toLowerCase() });
    },
  );

  it("returns dry-run output for token transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies();

    const result = await transferTokens(
      await readyWallet(),
      { args: { amount: "1.5", token: usdcToken, to: recipient }, options: { "dry-run": true } },
      runtime,
    );

    expect(result).toEqual({
      status: "dry_run",
      chain_id: 4217,
      network: "tempo",
      amount: "1.5",
      symbol: "USDC.e",
      token: usdcToken,
      to: recipient,
      from: testWallet.toLowerCase(),
      fee_token: usdcToken,
      fee_estimate: "0.000175",
      balance: "5",
      fee_token_balance: "5",
      sufficient_balance: true,
      instruction: `Review the transfer, then run the next command to send 1.5 USDC.e to ${recipient}.`,
      _next: {
        argv: [
          "tempo",
          "wallet",
          "send",
          "1.5",
          usdcToken,
          recipient,
          "--fee-token",
          usdcToken,
          "--yes",
          "--network",
          "mainnet",
        ],
        command: `tempo wallet send 1.5 ${usdcToken} ${recipient} --fee-token ${usdcToken} --yes --network mainnet`,
      },
    });
    const account = testWallet.toLowerCase();
    expect(runtime.getBalance).toHaveBeenCalledExactlyOnceWith({
      account,
      decimals: 6,
      token: usdcToken,
    });
    expect(runtime.estimateFee).toHaveBeenCalledExactlyOnceWith({
      account,
      amount: 1_500_000n,
      feeToken: undefined,
      to: recipient,
      token: usdcToken,
    });
    expect(runtime.getUserFeeToken).toHaveBeenCalledExactlyOnceWith(account);
    expect(runtime.confirm).not.toHaveBeenCalled();
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  // Balances are keyed by token; a token without one fails its lookup. The fee is 0.000175.
  it.each<{
    name: string;
    balances: Record<string, bigint>;
    options?: { "fee-token": string };
    runtime?: Record<string, unknown>;
    expected?: Record<string, unknown>;
    sufficient: boolean | null;
  }>([
    {
      name: "a balance covering the amount and fee",
      balances: { [usdcToken]: 1_500_175n },
      expected: { balance: "1.500175", fee_token_balance: "1.500175" },
      sufficient: true,
    },
    {
      name: "a balance short of the fee",
      balances: { [usdcToken]: 1_500_174n },
      expected: { balance: "1.500174", fee_token_balance: "1.500174" },
      sufficient: false,
    },
    {
      name: "a balance short of the amount",
      balances: { [usdcToken]: 1_000_000n },
      expected: { balance: "1", fee_token_balance: "1" },
      sufficient: false,
    },
    // Another fee token must cover the fee from its own balance.
    {
      name: "a --fee-token balance covering the fee",
      balances: { [usdcToken]: 1_500_000n, [moderatoToken]: 175n },
      options: { "fee-token": moderatoToken },
      expected: { fee_token: moderatoToken, fee_token_balance: "0.000175" },
      sufficient: true,
    },
    {
      name: "a --fee-token balance short of the fee",
      balances: { [usdcToken]: 1_500_000n, [moderatoToken]: 174n },
      options: { "fee-token": moderatoToken },
      expected: { fee_token: moderatoToken, fee_token_balance: "0.000174" },
      sufficient: false,
    },
    {
      name: "a --fee-token covering the fee and a balance short of the amount",
      balances: { [usdcToken]: 1_000_000n, [moderatoToken]: 175n },
      options: { "fee-token": moderatoToken },
      expected: { balance: "1", fee_token: moderatoToken, fee_token_balance: "0.000175" },
      sufficient: false,
    },
    {
      name: "an unreadable --fee-token balance",
      balances: { [usdcToken]: 1_500_000n },
      options: { "fee-token": moderatoToken },
      expected: { fee_token: moderatoToken, fee_token_balance: null },
      sufficient: null,
    },
    {
      name: "a failed fee estimate with the fee paid in --fee-token",
      balances: { [usdcToken]: 1_500_000n, [moderatoToken]: 1_000_000n },
      options: { "fee-token": moderatoToken },
      runtime: { estimateFee: unavailable() },
      expected: { fee_estimate: null, fee_token: moderatoToken, fee_token_balance: "1" },
      sufficient: null,
    },
    {
      name: "the account's default fee token covering the fee",
      balances: { [usdcToken]: 1_500_000n, [moderatoToken]: 175n },
      runtime: { getUserFeeToken: vi.fn(async () => moderatoToken) },
      expected: { fee_token: moderatoToken, fee_token_balance: "0.000175" },
      sufficient: true,
    },
    {
      name: "the account's default fee token short of the fee",
      balances: { [usdcToken]: 1_500_000n, [moderatoToken]: 0n },
      runtime: { getUserFeeToken: vi.fn(async () => moderatoToken) },
      expected: { fee_token: moderatoToken, fee_token_balance: "0" },
      sufficient: false,
    },
    // An unreadable default may or may not be the transferred token.
    {
      name: "an unreadable default fee token",
      balances: { [usdcToken]: 1_500_175n },
      runtime: { getUserFeeToken: unavailable() },
      expected: { balance: "1.500175", fee_token: null, fee_token_balance: null },
      sufficient: null,
    },
    {
      name: "an unreadable default fee token and a balance short of the amount",
      balances: { [usdcToken]: 1_000_000n },
      runtime: { getUserFeeToken: unavailable() },
      expected: { balance: "1", fee_token: null, fee_token_balance: null },
      sufficient: false,
    },
    // The fee is unknown, so a balance covering only the amount may fall short.
    {
      name: "a failed fee estimate",
      balances: { [usdcToken]: 1_500_000n },
      runtime: { estimateFee: unavailable() },
      expected: { fee_estimate: null },
      sufficient: null,
    },
    {
      name: "a failed fee estimate and a balance short of the amount",
      balances: { [usdcToken]: 1_000_000n },
      runtime: { estimateFee: unavailable() },
      expected: { balance: "1", fee_estimate: null, fee_token_balance: "1" },
      sufficient: false,
    },
    {
      name: "a failed balance lookup",
      balances: {},
      expected: { balance: null, fee_token_balance: null },
      sufficient: null,
    },
    {
      name: "every lookup failing",
      balances: {},
      runtime: { estimateFee: unavailable(), getUserFeeToken: unavailable() },
      expected: { balance: null, fee_estimate: null, fee_token: null, fee_token_balance: null },
      sufficient: null,
    },
  ])(
    "reports the fee and balances with $name",
    async ({ balances, options = {}, runtime = {}, expected = {}, sufficient }) => {
      await useTempHome();
      await writeWalletState(walletState());
      const lookups = dependencies({
        getBalance: vi.fn(async ({ token }: { token: string }) => {
          const balance = balances[token];
          if (balance === undefined) throw new Error("RPC unavailable");
          return balance;
        }),
        ...runtime,
      });

      const result = await transferTokens(
        await readyWallet(),
        {
          args: { amount: "1.5", token: usdcToken, to: recipient },
          options: { "dry-run": true, ...options },
        },
        lookups,
      );

      const output = { fee_token: usdcToken, ...expected };
      expect(result).toMatchObject({
        status: "dry_run",
        fee_estimate: "0.000175",
        balance: "1.5",
        fee_token_balance: "1.5",
        ...output,
        sufficient_balance: sufficient,
      });
      // The continuation pins the reviewed fee token, and only a known one.
      const argv = (result as { _next: { argv: string[] } })._next.argv;
      expect(argv.includes("--fee-token") ? argv[argv.indexOf("--fee-token") + 1] : null).toBe(
        output.fee_token,
      );
      // A different fee token's balance is read too, in its 6 fee-token decimals.
      const account = testWallet.toLowerCase();
      const otherFeeToken = output.fee_token !== null && output.fee_token !== usdcToken;
      expect(lookups.getBalance.mock.calls).toEqual([
        [{ account, decimals: 6, token: usdcToken }],
        ...(otherFeeToken ? [[{ account, decimals: 6, token: output.fee_token }]] : []),
      ]);
      expect(lookups.estimateFee).toHaveBeenCalledWith(
        expect.objectContaining({ feeToken: options["fee-token"] }),
      );
      expect(lookups.getUserFeeToken).toHaveBeenCalledTimes(options["fee-token"] ? 0 : 1);
      expect(lookups.submit).not.toHaveBeenCalled();
    },
  );

  // The default lookups bound each RPC call, so a stalled RPC cannot hold up the dry run.
  it("reports null fee and balance when the RPC stalls", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const stalled = createServer(() => undefined);
    await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const address = stalled.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    vi.stubEnv("TEMPO_RPC_URL", `http://127.0.0.1:${address.port}`);
    const started = Date.now();

    try {
      const result = await transferTokens(await readyWallet(), {
        args: { amount: "1.5", token: usdcToken, to: recipient },
        options: { "dry-run": true },
      });

      expect(result).toMatchObject({
        fee_token: null,
        fee_estimate: null,
        balance: null,
        fee_token_balance: null,
        sufficient_balance: null,
      });
      expect(Date.now() - started).toBeLessThan(9_000);
    } finally {
      vi.unstubAllEnvs();
      stalled.closeAllConnections();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
  }, 15_000);

  it.each<{
    name: string;
    interactive: boolean | undefined;
    yes?: boolean;
    answer?: boolean;
    error?: string;
    feeToken?: string;
  }>([
    { name: "a non-interactive run without --yes", interactive: false, error: notReviewed },
    {
      name: "a run not marked interactive without --yes",
      interactive: undefined,
      error: notReviewed,
    },
    { name: "a non-interactive run with --yes", interactive: false, yes: true },
    { name: "an interactive run with --yes", interactive: true, yes: true },
    // The prompt names the fee token, so the send pins it.
    {
      name: "an interactive run confirmed at the prompt",
      interactive: true,
      answer: true,
      feeToken: usdcToken,
    },
    {
      name: "an interactive run declined at the prompt",
      interactive: true,
      answer: false,
      error: declined,
    },
  ])("sends only when confirmed: $name", async ({ interactive, yes, answer, error, feeToken }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies({ confirm: vi.fn(async () => answer ?? true) });

    const result = await transferTokens(
      await readyWallet(),
      {
        args: { amount: "1.5", token: usdcToken, to: recipient },
        options: yes ? { yes } : {},
        interactive,
      },
      runtime,
    ).catch((value: unknown) => value);

    if (error) {
      expectUsageError(result, error);
      expect(runtime.submit).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({
        status: "success",
        tx_hash: txHash,
        chain_id: 4217,
        network: "tempo",
        amount: "1.5",
        symbol: "USDC.e",
        token: usdcToken,
        to: recipient,
        from: testWallet.toLowerCase(),
      });
      expect(runtime.submit).toHaveBeenCalledExactlyOnceWith({
        call: expect.objectContaining({
          to: usdcToken,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [recipient, 1_500_000n],
          }),
        }),
        // An unreviewed --yes send leaves the fee token to the protocol, as before.
        feeToken,
        from: testWallet,
        network: { name: "mainnet", chainId: 4217 },
      });
    }
    expect(runtime.confirm).toHaveBeenCalledTimes(answer === undefined ? 0 : 1);
    expect(runtime.getBalance).not.toHaveBeenCalled();
    expect(runtime.estimateFee).not.toHaveBeenCalled();
  });

  it.each<{
    name: string;
    options?: { "fee-token": string };
    runtime?: Record<string, unknown>;
    feeToken: string;
    submitted: string;
  }>([
    {
      name: "the transferred token",
      feeToken: `USDC.e (${usdcToken})`,
      submitted: usdcToken,
    },
    {
      name: "--fee-token",
      options: { "fee-token": "pathUSD" },
      feeToken: `pathUSD (${moderatoToken})`,
      submitted: moderatoToken,
    },
    {
      name: "the account's default fee token",
      runtime: { getUserFeeToken: vi.fn(async () => moderatoToken) },
      feeToken: `pathUSD (${moderatoToken})`,
      submitted: moderatoToken,
    },
    {
      name: "an unlisted default fee token",
      runtime: { getUserFeeToken: vi.fn(async () => unlistedToken) },
      feeToken: unlistedToken,
      submitted: unlistedToken,
    },
  ])(
    "prompts with the amount, token, recipient, network, and $name as fee token, then pins it",
    async ({ options = {}, runtime = {}, feeToken, submitted }) => {
      await useTempHome();
      await writeWalletState(walletState());
      const lookups = dependencies(runtime);

      await transferTokens(
        await readyWallet(),
        { args: { amount: "1.5", token: "USDC", to: recipient }, options, interactive: true },
        lookups,
      );

      expect(lookups.confirm).toHaveBeenCalledExactlyOnceWith(
        [
          `Send 1.5 USDC.e (${usdcToken})`,
          `  to:        ${recipient}`,
          "  network:   mainnet (chain 4217)",
          `  fee token: ${feeToken}`,
          "Send this transfer?",
        ].join("\n"),
      );
      expect(lookups.submit).toHaveBeenCalledWith(expect.objectContaining({ feeToken: submitted }));
    },
  );

  it("refuses to prompt when the account's default fee token cannot be read", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const lookups = dependencies({ getUserFeeToken: unavailable() });

    const error = await transferTokens(
      await readyWallet(),
      { args: { amount: "1.5", token: usdcToken, to: recipient }, options: {}, interactive: true },
      lookups,
    ).catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "E_NETWORK",
      exitCode: 3,
      message:
        "Transfer not sent: unable to read the account's default fee token. Pass --fee-token to choose one, or retry.",
    });
    expect(lookups.confirm).not.toHaveBeenCalled();
    expect(lookups.submit).not.toHaveBeenCalled();
  });

  // The provider sends on the wallet's saved chain unless the request names one, and falls back
  // to wallet-app approval on that chain when no access key can sign, so a transfer on another
  // network is refused, with or without a key there, before any lookup or prompt. A dry run
  // still reviews it.
  it.each(
    [
      { stored: 4217, network: "mainnet", refusal: undefined },
      { stored: 42431, network: "testnet", refusal: undefined },
      {
        stored: 4217,
        network: "testnet",
        refusal: "wallet is logged in on tempo, not tempo-moderato",
      },
      {
        stored: 42431,
        network: "mainnet",
        refusal: "wallet is logged in on tempo-moderato, not tempo",
      },
    ].flatMap((chains) => [
      { ...chains, key: "a usable access key", expiry: 2_000_000_000, mode: "--yes" },
      { ...chains, key: "no usable access key", expiry: 1, mode: "the prompt" },
    ]),
  )(
    "transfers --network $network over a $stored login with $key and $mode: $refusal",
    async ({ stored, network, refusal, expiry, mode }) => {
      await useTempHome();
      const key = { ...walletState().accessKeys[0]!, expiry };
      await writeWalletState(
        walletState({ chainId: stored, accessKeys: [key, { ...key, chainId: 42431 }] }),
      );
      const { chainId } = parseNetwork(network);
      // Interactive runs reach the transfer without a usable key.
      const wallet = await readyWallet(network, false);
      const { submit: _submit, ...lookups } = dependencies();
      const args = { amount: "1.5", token: "pathUSD", to: recipient };
      mocks.request.mockClear();

      const dryRun = await transferTokens(wallet, { args, options: { "dry-run": true } }, lookups);
      lookups.getUserFeeToken.mockClear();
      const result = await transferTokens(
        wallet,
        mode === "--yes"
          ? { args, options: { yes: true } }
          : { args, options: {}, interactive: true },
        lookups,
      );

      const command = `tempo wallet login --network ${network}`;
      expect(dryRun).toMatchObject({ status: "dry_run", chain_id: chainId });
      expect(result).toEqual(
        refusal
          ? {
              code: "E_USAGE",
              message: `Transfer not sent: ${refusal}; log in with '${command}', then rerun the transfer.`,
              exitCode: 2,
              retryable: false,
              cta: { commands: [{ command }] },
            }
          : expect.objectContaining({ status: "success", chain_id: chainId }),
      );
      expect(mocks.request.mock.calls).toEqual(
        refusal
          ? []
          : [
              [
                {
                  method: "eth_sendTransactionSync",
                  params: [
                    {
                      from: testWallet,
                      calls: [expect.objectContaining({ to: moderatoToken })],
                      chainId: toHex(chainId),
                      // The prompt names the fee token, so that send pins it.
                      ...(mode === "the prompt" ? { feeToken: moderatoToken } : {}),
                    },
                  ],
                },
              ],
            ],
      );
      // A refusal comes before the fee-token read and the prompt.
      expect(lookups.getUserFeeToken).toHaveBeenCalledTimes(refusal || mode === "--yes" ? 0 : 1);
      expect(lookups.confirm).toHaveBeenCalledTimes(refusal || mode === "--yes" ? 0 : 1);
    },
  );

  // Another process can log in on another chain while the prompt is open; the provider loads that
  // chain when the send creates it, so the send checks it again.
  it.each([
    { name: "the login is unchanged", switchTo: undefined },
    { name: "another login switched to testnet", switchTo: 42431 },
  ])("sends after the prompt only if $name", async ({ switchTo }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const { submit: _submit, ...lookups } = dependencies({
      confirm: vi.fn(async () => {
        if (switchTo !== undefined) await writeWalletState(walletState({ chainId: switchTo }));
        return true;
      }),
    });
    mocks.request.mockClear();

    const result = await transferTokens(
      await readyWallet(),
      { args: { amount: "1", token: usdcToken, to: recipient }, options: {}, interactive: true },
      lookups,
    ).catch((value: unknown) => value);

    expect(lookups.confirm).toHaveBeenCalledOnce();
    if (switchTo === undefined) {
      expect(result).toMatchObject({ status: "success" });
      expect(mocks.request).toHaveBeenCalledOnce();
    } else {
      expectUsageError(
        result,
        "The wallet is now logged in on tempo-moderato, not tempo, so nothing was sent. Log in with 'tempo wallet login --network mainnet', then retry.",
      );
      // `ctaErrors` returns the login it needs as the cta.
      expect(result).toMatchObject({
        payload: { cta: { commands: [{ command: "tempo wallet login --network mainnet" }] } },
      });
      expect(mocks.request).not.toHaveBeenCalled();
    }
  });

  it.each([
    { name: "a matching --address", address: testWallet, error: undefined },
    {
      name: "a matching --address in lowercase",
      address: testWallet.toLowerCase(),
      error: undefined,
    },
    {
      name: "another --address",
      address: testWallet2,
      error: "--address must match the logged-in wallet",
    },
  ])("checks $name in dry runs and sends alike", async ({ address, error }) => {
    await useTempHome();
    await writeWalletState(walletState());

    for (const mode of [{ "dry-run": true }, { yes: true }]) {
      const runtime = dependencies();
      const result = await transferTokens(
        await readyWallet(),
        {
          args: { amount: "1", token: usdcToken, to: recipient },
          options: { ...mode, address },
        },
        runtime,
      ).catch((value: unknown) => value);

      if (error) {
        expectUsageError(result, error);
        expect(runtime.getBalance).not.toHaveBeenCalled();
        expect(runtime.submit).not.toHaveBeenCalled();
      } else {
        // The review and the send describe the logged-in wallet.
        expect(result).toMatchObject({ from: testWallet.toLowerCase() });
        if ("dry-run" in mode)
          expect(runtime.getBalance).toHaveBeenCalledWith(
            expect.objectContaining({ account: testWallet.toLowerCase() }),
          );
        else expect(runtime.submit).toHaveBeenCalledOnce();
      }
    }
  });

  it("uses the pathUSD symbol for Moderato token transfers", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, chainId: 42431 }] }),
    );

    const result = await transferTokens(
      await readyWallet("testnet"),
      {
        args: { amount: "1.5", token: moderatoToken, to: recipient },
        options: { "dry-run": true },
      },
      dependencies(),
    );

    expect(result).toMatchObject({
      chain_id: 42431,
      symbol: "pathUSD",
      token: moderatoToken,
    });
  });

  it.each(tokenInputs)(
    "resolves $input on $network as the token and --fee-token",
    async ({ input, network, address, symbol }) => {
      await useTempHome();
      await writeWalletState(walletState());

      const result = await transferTokens(
        await readyWallet(network, false),
        {
          args: { amount: "1.5", token: input, to: recipient },
          options: { "dry-run": true, "fee-token": input },
        },
        dependencies(),
      );

      expect(result).toMatchObject({
        status: "dry_run",
        amount: "1.5",
        symbol,
        token: address,
        fee_token: address,
      });
      // Continuations carry the resolved addresses rather than the typed symbol.
      expect((result as { _next: { argv: string[] } })._next.argv.slice(2, 8)).toEqual([
        "send",
        "1.5",
        address,
        recipient,
        "--fee-token",
        address,
      ]);
    },
  );

  it.each(
    (["token", "fee-token"] as const).flatMap((position) =>
      invalidTokenInputs(position === "token" ? "token" : "fee token").map((row) => ({
        ...row,
        position,
      })),
    ),
  )("rejects $position $input on $network", async ({ position, input, network, message }) => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await transferTokens(
      await readyWallet(network, false),
      {
        args: { amount: "1", token: position === "token" ? input : moderatoToken, to: recipient },
        options: {
          "dry-run": true,
          ...(position === "fee-token" ? { "fee-token": input } : {}),
        },
      },
      dependencies(),
    ).catch((err: unknown) => err);

    expectTokenError(error, message);
  });
  it("reads an unlisted token's decimals and sanitized symbol on chain", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.getMetadata.mockResolvedValue({ decimals: 2, symbol: "\u001b[2JTWO​" });

    const result = await transferTokens(
      await readyWallet(),
      {
        args: { amount: "1.25", token: unlistedToken, to: recipient },
        options: { "dry-run": true },
      },
      dependencies({ getBalance: vi.fn(async () => 125n) }),
    );
    const error = await transferTokens(
      await readyWallet(),
      {
        args: { amount: "1.255", token: unlistedToken, to: recipient },
        options: { "dry-run": true },
      },
      dependencies(),
    ).catch((err: unknown) => err);

    expect(result).toMatchObject({
      symbol: "TWO",
      token: unlistedToken,
      // The balance is in the token's decimals; the fee is in the fee token's.
      balance: "1.25",
      fee_estimate: "0.000175",
      instruction: `Review the transfer, then run the next command to send 1.25 TWO to ${recipient}.`,
    });
    expectUsageError(error, "Invalid amount: expected a positive decimal with at most 2 decimals");
    expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual([
      { token: unlistedToken },
      { token: unlistedToken },
    ]);
  });

  it.each(untrustedSymbols)(
    "names an unlisted token by its address, never its on-chain symbol %j",
    async (symbol) => {
      await useTempHome();
      await writeWalletState(walletState());
      mocks.getMetadata.mockResolvedValue({ decimals: 6, symbol });
      const runtime = dependencies();

      const result = await transferTokens(
        await readyWallet(),
        {
          args: { amount: "1", token: unlistedToken, to: recipient },
          options: { "dry-run": true },
        },
        runtime,
      );
      await transferTokens(
        await readyWallet(),
        {
          args: { amount: "1", token: unlistedToken, to: recipient },
          options: {},
          interactive: true,
        },
        runtime,
      );

      expect(result).toMatchObject({
        symbol: null,
        token: unlistedToken,
        instruction: `Review the transfer, then run the next command to send 1 ${unlistedToken} to ${recipient}.`,
      });
      expect(containsSymbol(result, symbol)).toBe(false);
      const [question] = runtime.confirm.mock.calls[0] as unknown as [string];
      expect(question).toContain(`Send 1 ${unlistedToken}\n`);
      expect(question).toContain(`fee token: ${unlistedToken}\n`);
      expect(question).not.toContain(symbol);
    },
  );

  it.each([
    { name: "sends from the wallet it checked", replaced: false },
    { name: "sends nothing once another login replaced the wallet", replaced: true },
  ])("$name", async ({ replaced }) => {
    await useTempHome();
    await writeWalletState(walletState());
    if (replaced)
      mocks.getAccount.mockImplementationOnce(() => {
        throw new Error(`Account "${testWallet}" not found.`);
      });

    const result = transferTokens(await readyWallet(), {
      args: { amount: "1", token: usdcToken, to: recipient },
      options: { yes: true },
    });

    if (replaced) {
      await expect(result).rejects.toThrow(
        `Wallet ${testWallet.toLowerCase()} is no longer logged in, so nothing was sent. Check the login with 'tempo wallet whoami', then retry.`,
      );
      await expect(result).rejects.toMatchObject({ code: "E_NOT_AUTHENTICATED" });
      expect(mocks.request).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toMatchObject({
        status: "success",
        from: testWallet.toLowerCase(),
      });
      expect(mocks.request).toHaveBeenCalledWith({
        method: "eth_sendTransactionSync",
        params: [expect.objectContaining({ from: testWallet, calls: [expect.any(Object)] })],
      });
    }
    expect(mocks.getAccount).toHaveBeenCalledWith({ address: testWallet });
  });
});

const machChallenge = `Payment realm="example", method="tempo", intent="charge", id="abc123", expires="2099-01-01T00:00:00Z", request="${Buffer.from(
  JSON.stringify({
    amount: "1000000",
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217, machineTokenEnabled: true },
  }),
).toString("base64url")}"`;

describe("tempo wallet send and transfer", () => {
  // The requests show how far a run got. Reading the account's default fee token is an
  // `eth_call`, which returns zero (no default, so the transferred token pays); everything else
  // fails.
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const call = (() => {
        try {
          return JSON.parse(body) as { id?: number; method?: string };
        } catch {
          return {};
        }
      })();
      requests.push([request.method, request.url, call.method].filter(Boolean).join(" "));
      if (call.method !== "eth_call") {
        response.statusCode = 500;
        return response.end();
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: `0x${"0".repeat(64)}` }));
    });
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

  const tokens = ["1", usdcToken, recipient];
  const prompt = "Send this transfer? [y/N] ";
  const notice =
    "Warning: 'tempo wallet transfer <amount> <token> <to>' is deprecated; use 'tempo wallet send <amount> <token> <to>'.\n";
  // A token transfer is sent through the wallet provider. Its transaction fill fails against this
  // fixture, so it falls back to the wallet app and registers a device, which fails too.
  const sent = /device-code \/register returned status 500/;

  type Run = {
    name: string;
    argv: string[];
    terminal?: "stdout" | "stdin and stdout";
    input?: string;
    prompted?: boolean;
    refused?: string;
    requests?: string[];
    reached?: string | RegExp;
    /** Whether stderr notes that the token form of `transfer` is deprecated. */
    deprecated?: boolean;
  };

  const tokenRuns: Run[] = [
    {
      name: "an agent run without --yes refuses before any request",
      argv: tokens,
      refused: notReviewed,
      requests: [],
    },
    { name: "an agent run with --yes sends", argv: [...tokens, "--yes"], reached: sent },
    // Piped input is not a person answering, even when output goes to a terminal.
    {
      name: "a terminal run with piped stdin refuses without --yes, ignoring the input",
      argv: tokens,
      terminal: "stdout",
      input: "yes\n",
      refused: notReviewed,
      requests: [],
    },
    {
      name: "a terminal run with piped stdin and --yes sends without a prompt",
      argv: [...tokens, "--yes"],
      terminal: "stdout",
      reached: sent,
    },
    {
      name: "an interactive run declined at the prompt sends nothing",
      argv: tokens,
      terminal: "stdin and stdout",
      input: "n\n",
      prompted: true,
      refused: declined,
      requests: ["POST / eth_call"],
    },
    {
      name: "an interactive run whose input ends at the prompt sends nothing",
      argv: tokens,
      terminal: "stdin and stdout",
      input: "",
      prompted: true,
      refused: declined,
      requests: ["POST / eth_call"],
    },
    {
      name: "an interactive run confirmed at the prompt sends",
      argv: tokens,
      terminal: "stdin and stdout",
      input: "yes\n",
      prompted: true,
      reached: sent,
    },
    {
      name: "an interactive run with --yes sends without a prompt",
      argv: [...tokens, "--yes"],
      terminal: "stdin and stdout",
      reached: sent,
    },
  ];

  const mach = ["transfer", "--mach", "--max-spend", "1", "--mpp-challenge", machChallenge];

  it.each<Run>([
    // `transfer` runs `send` for a token transfer, noting on a terminal that it is deprecated.
    ...(["send", "transfer"] as const).flatMap((command) =>
      tokenRuns.map((run) => ({
        ...run,
        name: `${command}: ${run.name}`,
        argv: [command, ...run.argv],
        deprecated: command === "transfer" && run.terminal !== undefined,
      })),
    ),
    {
      name: "transfer --credits without --yes redeems as before",
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient],
      reached: "POST /api/coinflow/redeem/auth-msg",
    },
    {
      name: "transfer --mach without --yes settles as before",
      argv: mach,
      reached: "POST / eth_call",
    },
    {
      name: "transfer --mach on a terminal settles without the token notice",
      argv: mach,
      terminal: "stdout",
      reached: "POST / eth_call",
    },
  ])(
    "$name",
    async ({
      argv,
      terminal,
      input = "",
      prompted = false,
      refused,
      deprecated = false,
      ...expected
    }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      requests.length = 0;

      const result = await walletCli(argv, { home, terminal, input });

      expect(result.stderr).not.toContain("blocked outbound connection");
      expect(result.stderr.includes(prompt), JSON.stringify(result)).toBe(prompted);
      expect(result.stderr.includes(notice), JSON.stringify(result)).toBe(deprecated);
      if (prompted)
        expect(result.stderr).toContain(
          `Send 1 USDC.e (${usdcToken})\n  to:        ${recipient}\n  network:   mainnet (chain 4217)\n  fee token: USDC.e (${usdcToken})\n`,
        );
      if (refused) {
        expect(result.code).toBe(2);
        expect(result.stdout).toContain(refused);
      } else expect(result.stdout).not.toContain("Transfer not sent");
      if (expected.requests) expect(requests).toEqual(expected.requests);
      if (expected.reached instanceof RegExp) {
        expect(result.stdout).toMatch(expected.reached);
        // The provider fills the transaction through TEMPO_RPC_URL, not viem's default chain RPC.
        expect(requests).toContain("POST / eth_fillTransaction");
      } else if (expected.reached) expect(requests).toContain(expected.reached);
    },
    30_000,
  );

  it.each([undefined, "stdout"] as const)(
    "transfer returns what send does for a token dry run (terminal: %s)",
    async (terminal) => {
      const home = await useTempHome();
      await writeWalletState(walletState());

      const [send, transfer] = await Promise.all(
        ["send", "transfer"].map((command) =>
          walletCli([command, ...tokens, "--dry-run"], { home, terminal, input: "" }),
        ),
      );

      expect(send!.code).toBe(0);
      expect(transfer!.stdout).toBe(send!.stdout);
      expect(send!.stdout).toContain(
        `tempo wallet send 1 ${usdcToken} ${recipient} --fee-token ${usdcToken} --yes --network mainnet`,
      );
      expect(send!.stderr).toBe("");
      expect(transfer!.stderr).toBe(terminal ? notice : "");
    },
    30_000,
  );

  // `send` sends tokens only; MACH and MPP Credits payments keep their `transfer` form.
  const machMessage =
    "'send' sends tokens only; to pay an MPP challenge with MACH, use 'tempo wallet transfer --mach'.";
  const creditsMessage =
    "'send' sends tokens only; to spend legacy MPP Credits, use 'tempo wallet transfer --credits'.";

  // The `cta` runs the arguments as given under `transfer`; an explicit false selects no mode, so
  // the run is a token send, which without --yes sends nothing.
  it.each([
    {
      argv: ["--mach", "--max-spend", "1", "--mpp-challenge", machChallenge],
      message: machMessage,
    },
    { argv: ["--amount-cents", "100", "--to", recipient, "--credits"], message: creditsMessage },
    { argv: [...tokens, "--mach=true", "--yes"], message: machMessage },
    { argv: [...tokens, "--mach", "true", "--yes"], message: machMessage },
    { argv: [...tokens, "--credits=true"], message: creditsMessage },
    { argv: [...tokens, "--mach=false"], message: undefined },
    { argv: [...tokens, "--mach", "false"], message: undefined },
    { argv: [...tokens, "--credits=false"], message: undefined },
    { argv: [...tokens, "--credits", "false"], message: undefined },
    { argv: [...tokens, "--no-mach"], message: undefined },
    { argv: [...tokens, "--no-credits"], message: undefined },
  ])("send $argv sends nothing", async ({ argv, message }) => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    requests.length = 0;

    const result = await walletCli(["send", ...argv], { home, terminal: undefined, input: "" });

    const command = ["tempo", "wallet", "transfer", ...argv, "--format", "json"]
      .map(shellQuote)
      .join(" ");
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(
      message
        ? {
            code: "E_USAGE",
            message,
            retryable: false,
            cta: { description: "Suggested command:", commands: [{ command }] },
          }
        : { code: "E_USAGE", message: notReviewed, retryable: false },
    );
    expect(requests).toEqual([]);
  });

  // Each legacy flag fails with what replaces it before the command parses its options or runs,
  // and its `cta` is the equivalent command when the run's arguments give one.
  const retired = {
    to: "--to sets the MPP Credits recipient of 'tempo wallet transfer --credits'; pass a token transfer's recipient as the third argument: 'tempo wallet send <amount> <token> <to>'.",
    data: "--data sets the MPP Credits calldata of 'tempo wallet transfer --credits'; a token transfer sends no calldata.",
    cents:
      "--amount-cents sets the MPP Credits amount of 'tempo wallet transfer --credits'; pass a token transfer's amount in token units as the first argument: 'tempo wallet send <amount> <token> <to>'.",
    value: "--value was removed: transfers carry no ETH value.",
    machCents:
      "--amount-cents was removed from --mach; pass the spending cap in USD with --max-spend.",
    claim:
      "--claim was removed; pass the referral code with --referral-code: 'tempo wallet fund --referral-code <code>'.",
  };
  const cta = (...argv: string[]) => ["tempo", "wallet", ...argv].map(shellQuote).join(" ");
  const json = ["--format", "json"];

  it.each<{ argv: string[]; message: string; command?: string }>([
    {
      argv: ["transfer", "1", usdcToken, "--to", recipient],
      message: retired.to,
      command: cta("send", "1", usdcToken, recipient, ...json),
    },
    {
      argv: ["transfer", "1", usdcToken, `--to=${recipient}`, "--yes"],
      message: retired.to,
      command: cta("send", "1", usdcToken, recipient, "--yes", ...json),
    },
    {
      argv: ["send", "1", usdcToken, "--to", recipient, "--dry-run"],
      message: retired.to,
      command: cta("send", "1", usdcToken, recipient, "--dry-run", ...json),
    },
    { argv: ["send", "--to", recipient], message: retired.to },
    { argv: ["transfer", ...tokens, "--data", "0x12", "--yes"], message: retired.data },
    { argv: ["send", ...tokens, "--data", "0x12", "--yes"], message: retired.data },
    { argv: ["transfer", "--amount-cents", "100", "--to", recipient], message: retired.cents },
    { argv: ["send", ...tokens, "--amount-cents", "100", "--yes"], message: retired.cents },
    {
      argv: ["transfer", ...tokens, "--value", "0", "--yes"],
      message: retired.value,
      command: cta("send", ...tokens, "--yes", ...json),
    },
    {
      argv: ["send", ...tokens, "--value=0x0", "--yes"],
      message: retired.value,
      command: cta("send", ...tokens, "--yes", ...json),
    },
    {
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient, "--value", "0"],
      message: retired.value,
      command: cta("transfer", "--credits", "--amount-cents=100", `--to=${recipient}`, ...json),
    },
    // A nonzero value has no equivalent.
    {
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient, "--value", "1"],
      message: retired.value,
    },
    {
      argv: ["transfer", "--mach", "--amount-cents", "2", "--mpp-challenge", machChallenge],
      message: retired.machCents,
      command: cta(
        "transfer",
        "--mach",
        `--mpp-challenge=${machChallenge}`,
        ...json,
        "--max-spend",
        "0.02",
      ),
    },
    // Any value is refused, though only whole cents have a USD equivalent.
    {
      argv: ["transfer", "--mach", "--amount-cents", "abc", "--mpp-challenge", machChallenge],
      message: retired.machCents,
    },
    {
      argv: ["transfer", "--mach", "--amount-cents", "2", "--max-spend", "0.05"],
      message: retired.machCents,
      command: cta("transfer", "--mach", "--max-spend=0.05", ...json),
    },
    // `send` takes no option only `transfer` takes, so a cta that would carry one is left out.
    {
      argv: ["transfer", "1", usdcToken, "--to", recipient, "--max-spend", "5"],
      message: retired.to,
    },
    {
      argv: ["transfer", ...tokens, "--value", "0", "--mpp-client-id", "x"],
      message: retired.value,
    },
    // A code named like the `status` subcommand is still the retired flag's value.
    {
      argv: ["fund", "--claim", "status"],
      message: retired.claim,
      command: cta("fund", ...json, "--referral-code", "status"),
    },
    // A retired flag keeps the token after it as its value, so `--mcp` starts no MCP server.
    { argv: ["fund", "--claim", "--mcp"], message: retired.claim },
    { argv: ["send", ...tokens.slice(0, 2), "--to", "--mcp"], message: retired.to },
    // Each replacement covers only its own flag, so several retired flags get no cta.
    {
      argv: ["transfer", "1", usdcToken, "--value", "0", "--to", recipient],
      message: retired.value,
    },
    {
      argv: ["send", "1", usdcToken, "--to", recipient, "--data", "0x12", "--yes"],
      message: retired.to,
    },
    {
      argv: ["fund", "--claim", "CODE", "--no-browser"],
      message: retired.claim,
      command: cta("fund", "--no-browser", ...json, "--referral-code", "CODE"),
    },
  ])("$argv fails with its replacement and sends nothing", async ({ argv, message, command }) => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    requests.length = 0;

    const result = await walletCli(argv, { home, terminal: undefined, input: "" });

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "E_USAGE",
      message,
      retryable: false,
      ...(command ? { cta: { description: "Suggested command:", commands: [{ command }] } } : {}),
    });
    expect(result.stderr).toBe("");
    expect(requests).toEqual([]);
  });

  // `--credits` still takes its recipient, calldata, and amount.
  it("transfer --credits keeps --to, --data, and --amount-cents", async () => {
    const home = await useTempHome();
    await writeWalletState(walletState());

    const result = await walletCli(
      ["transfer", "--credits", "--amount-cents", "100", "--to", recipient, "--data", "0x12"],
      { home, terminal: undefined, input: "" },
    );

    expect(requests).toContain("POST /api/coinflow/redeem/auth-msg");
    expect(result.stdout).not.toContain("E_USAGE");
  });

  /**
   * Runs the wallet CLI as an agent (`--format json`), or with output to a `terminal`, and with
   * stdin a terminal too when it names both.
   */
  function walletCli(
    args: string[],
    {
      home,
      terminal,
      input,
    }: { home: string; terminal: "stdout" | "stdin and stdout" | undefined; input: string },
  ) {
    const fixture = terminal === "stdout" ? "interactive-stdout.mjs" : "interactive-terminal.mjs";
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      NO_COLOR: "1",
      TEMPO_AUTH_URL: origin,
      TEMPO_RPC_URL: origin,
    };
    delete childEnv.TEMPO_PRIVATE_KEY;
    delete childEnv.TEMPO_WALLET_NETWORK;
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        terminal
          ? ["--import", join(fixtures, fixture), cliBundle("wallet"), ...args]
          : [cliBundle("wallet"), ...args, "--format", "json"],
        { env: childEnv, timeout: 20_000 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") return reject(error);
          resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
        },
      );
      child.stdin?.end(input);
    });
  }
});
