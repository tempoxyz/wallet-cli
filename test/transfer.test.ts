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
  createProvider: vi.fn(async () => ({
    getAccount: mocks.getAccount,
    getClient: () => ({}),
    request: mocks.request,
  })),
}));

import { transferTokens } from "../src/commands/transfer.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { parseNetwork } from "../src/shared/network.js";
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
const usage = "usage: tempo wallet transfer <amount> <token> <to>";
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
          "transfer",
          "1.5",
          usdcToken,
          recipient,
          "--fee-token",
          usdcToken,
          "--yes",
          "--network",
          "mainnet",
        ],
        command: `tempo wallet transfer 1.5 ${usdcToken} ${recipient} --fee-token ${usdcToken} --yes --network mainnet`,
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
        "transfer",
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

describe("tempo wallet transfer", () => {
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

  const send = ["transfer", "1", usdcToken, recipient];
  const prompt = "Send this transfer? [y/N] ";
  // A token transfer is sent through the wallet provider. Its transaction fill fails against this
  // fixture, so it falls back to the wallet app and registers a device, which fails too.
  const sent = /device-code \/register returned status 500/;

  it.each<{
    name: string;
    argv: string[];
    terminal?: "stdout" | "stdin and stdout";
    input?: string;
    prompted?: boolean;
    refused?: string;
    requests?: string[];
    reached?: string | RegExp;
  }>([
    {
      name: "an agent run without --yes refuses before any request",
      argv: send,
      refused: notReviewed,
      requests: [],
    },
    { name: "an agent run with --yes sends", argv: [...send, "--yes"], reached: sent },
    // Piped input is not a person answering, even when output goes to a terminal.
    {
      name: "a terminal run with piped stdin refuses without --yes, ignoring the input",
      argv: send,
      terminal: "stdout",
      input: "yes\n",
      refused: notReviewed,
      requests: [],
    },
    {
      name: "a terminal run with piped stdin and --yes sends without a prompt",
      argv: [...send, "--yes"],
      terminal: "stdout",
      reached: sent,
    },
    {
      name: "an interactive run declined at the prompt sends nothing",
      argv: send,
      terminal: "stdin and stdout",
      input: "n\n",
      prompted: true,
      refused: declined,
      requests: ["POST / eth_call"],
    },
    {
      name: "an interactive run whose input ends at the prompt sends nothing",
      argv: send,
      terminal: "stdin and stdout",
      input: "",
      prompted: true,
      refused: declined,
      requests: ["POST / eth_call"],
    },
    {
      name: "an interactive run confirmed at the prompt sends",
      argv: send,
      terminal: "stdin and stdout",
      input: "yes\n",
      prompted: true,
      reached: sent,
    },
    {
      name: "an interactive run with --yes sends without a prompt",
      argv: [...send, "--yes"],
      terminal: "stdin and stdout",
      reached: sent,
    },
    {
      name: "--credits without --yes redeems as before",
      argv: ["transfer", "--credits", "--amount-cents", "100", "--to", recipient],
      reached: "POST /api/coinflow/redeem/auth-msg",
    },
    {
      name: "--mach without --yes settles as before",
      argv: ["transfer", "--mach", "--max-spend", "1", "--mpp-challenge", machChallenge],
      reached: "POST / eth_call",
    },
  ])(
    "$name",
    async ({ argv, terminal, input = "", prompted = false, refused, ...expected }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      requests.length = 0;

      const result = await walletCli(argv, { home, terminal, input });

      expect(result.stderr).not.toContain("blocked outbound connection");
      expect(result.stderr.includes(prompt), JSON.stringify(result)).toBe(prompted);
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
