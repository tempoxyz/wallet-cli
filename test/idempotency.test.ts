import { open, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Passes through, so a test can act between a prune's read and its delete.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const mocks = vi.hoisted(() => ({
  // The provider holds every wallet it is asked for.
  getAccount: vi.fn(({ address }: { address: string }) => ({ address })),
  // A receipt without a transaction hash.
  request: vi.fn(async (_request: { method: string; params: unknown[] }): Promise<unknown> => ({})),
}));

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(async () => ({ getAccount: mocks.getAccount, request: mocks.request })),
}));

import { swapTokens } from "../src/commands/swap.js";
import { transferTokens } from "../src/commands/transfer.js";
import type { TxState } from "../src/commands/tx.js";
import { paymentOutcomeUnknownError, walletError } from "../src/shared/errors.js";
import { missingKeyError, type Wallet } from "../src/shared/require-wallet.js";
import { nowSeconds, sleep } from "../src/shared/utils.js";
import {
  createIdempotencyRecord,
  idempotencyDir,
  loadIdempotencyRecord,
  pruneIdempotencyRecords,
  type IdempotencyRecord,
} from "../src/wallet/idempotency.js";
import {
  readyWallet,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";
const txHash = `0x${"ab".repeat(32)}`;
const day = 86_400;

/** Lookups for both commands, and a send that returns `txHash`. */
function lookups(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: vi.fn(async () => 100_000_000n),
    estimateFee: vi.fn(async () => 175n),
    getUserFeeToken: vi.fn(async (): Promise<`0x${string}` | null> => null),
    confirm: vi.fn(async () => true),
    getMetadata: vi.fn(async () => ({ decimals: 6, symbol: "TKN" })),
    getBuyQuote: vi.fn(async () => 1_010_000n),
    getSellQuote: vi.fn(async () => 980_000n),
    submit: vi.fn(async () => txHash),
    getTxStatus: vi.fn(async (): Promise<TxState> => "success"),
    ...overrides,
  };
}

/** Lookups for a rerun that must not send: a send, a quote, or a balance read fails the test. */
function rerunLookups(overrides: Record<string, unknown> = {}) {
  const refused = () => vi.fn(async () => Promise.reject(new Error("must not be called")));
  return lookups({
    getBalance: refused(),
    getBuyQuote: refused(),
    getSellQuote: refused(),
    submit: refused(),
    ...overrides,
  });
}

type Runtime = ReturnType<typeof lookups>;

/** A command's arguments; `token` is the transferred token, or the swap's output token. */
type Request = {
  key?: string | undefined;
  amount?: string | undefined;
  token?: string | undefined;
  to?: string | undefined;
  feeToken?: string | undefined;
  exactOut?: boolean | undefined;
  dryRun?: boolean | undefined;
  yes?: boolean | undefined;
  keyRequired?: ReturnType<typeof missingKeyError>;
};

const commands: Record<
  "transfer" | "swap",
  (wallet: Wallet, request: Request, runtime: Partial<Runtime>) => Promise<unknown>
> = {
  transfer: (wallet, request, runtime) =>
    transferTokens(
      wallet,
      {
        args: {
          amount: request.amount ?? "1",
          token: request.token ?? "pathUSD",
          to: request.to ?? recipient,
        },
        options: {
          "dry-run": request.dryRun,
          "fee-token": request.feeToken,
          "idempotency-key": request.key,
          yes: request.yes ?? true,
        },
        keyRequired: request.keyRequired,
      },
      runtime,
    ),
  swap: (wallet, request, runtime) =>
    swapTokens(
      wallet,
      {
        args: {
          amount: request.amount ?? "1",
          tokenIn: "pathUSD",
          tokenOut: request.token ?? "USDC.e",
        },
        options: {
          "dry-run": request.dryRun,
          "exact-out": request.exactOut,
          "fee-token": request.feeToken,
          "idempotency-key": request.key,
          "slippage-bps": 50,
          yes: request.yes ?? true,
        },
        keyRequired: request.keyRequired,
      },
      runtime,
    ),
};

const labels = { transfer: "Transfer", swap: "Swap" } as const;

/** Logs `address` in on `network` with an unlimited access key there, expiring at `expiry`. */
async function login(
  network: "mainnet" | "testnet" = "mainnet",
  address: string = testWallet,
  expiry = 2_000_000_000,
) {
  const chainId = network === "testnet" ? 42431 : 4217;
  const key = {
    ...walletState().accessKeys[0]!,
    access: address,
    chainId,
    expiry,
    limits: undefined,
  };
  await writeWalletState(walletState({ accounts: [{ address }], accessKeys: [key], chainId }));
  return readyWallet(network, false);
}

async function recordFiles() {
  return readdir(idempotencyDir()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

function outcomeUnknown(message: string, command: string) {
  return {
    code: "E_PAYMENT_OUTCOME_UNKNOWN",
    message,
    exitCode: 4,
    retryable: false,
    cta: { commands: [{ command }] },
  };
}

const statusCommand = `tempo wallet tx status ${txHash} --network mainnet`;
const balanceCommand = "tempo wallet whoami --network mainnet";
const checkTransaction = `Check transaction ${txHash} with '${statusCommand}' before retrying.`;

describe.each(["transfer", "swap"] as const)("%s --idempotency-key", (name) => {
  const send = commands[name];
  const label = labels[name];

  it.each<TxState>(["success", "reverted", "pending", "not_found"])(
    "replays the recorded result with chain status %s instead of sending",
    async (status) => {
      await useTempHome();
      const wallet = await login();
      const sent = await send(wallet, { key: "k1" }, lookups());
      const rerun = rerunLookups({ getTxStatus: vi.fn(async () => status) });

      // A replay sends nothing, so it needs no --yes.
      const replay = await send(wallet, { key: "k1", yes: false }, rerun);

      expect(sent).toMatchObject({ status: "success", tx_hash: txHash });
      expect(replay).toEqual({
        ...(sent as object),
        status,
        idempotent_replay: true,
        ...(status === "pending"
          ? {
              instruction:
                "The transaction is pending. Rerun the next command until its status is no longer pending.",
              _next: {
                argv: ["tempo", "wallet", "tx", "status", txHash, "--network", "mainnet"],
                command: statusCommand,
                until: '.status != "pending"',
                poll_interval_seconds: 1,
              },
            }
          : {}),
      });
      expect(rerun.getTxStatus).toHaveBeenCalledExactlyOnceWith(txHash);
      expect(rerun.submit).not.toHaveBeenCalled();
    },
  );

  const conflicts: {
    request: Request;
    differs?: string | undefined;
    other?: "transfer" | "swap";
  }[] =
    name === "transfer"
      ? [
          { request: { amount: "2" }, differs: "amount" },
          { request: { to: testWallet2 }, differs: "to" },
          { request: { token: "USDC.e" }, differs: "token" },
          { request: { feeToken: "USDC.e" }, differs: "fee_token" },
          { request: { amount: "1.000000" } },
          { request: {}, other: "swap", differs: "command" },
        ]
      : [
          { request: { amount: "2" }, differs: "amount" },
          { request: { token: "OUSD" }, differs: "token_out" },
          { request: { exactOut: true }, differs: "mode" },
          { request: { feeToken: "USDC.e" }, differs: "fee_token" },
          { request: { amount: "1.0" } },
          { request: {}, other: "transfer", differs: "command" },
        ];

  it.each(conflicts)(
    "checks a reused key against the request $request (other command: $other)",
    async ({ request, differs, other }) => {
      await useTempHome();
      const wallet = await login();
      await send(wallet, { key: "k1" }, lookups());
      const rerun = rerunLookups();

      const result = await commands[other ?? name](wallet, { ...request, key: "k1" }, rerun).catch(
        (error: unknown) => error,
      );

      if (differs === undefined)
        expect(result).toMatchObject({ status: "success", idempotent_replay: true });
      else
        expect(result).toMatchObject({
          code: "E_USAGE",
          exitCode: 2,
          message: `Idempotency key "k1" was already used on this wallet and network for a different request (different ${differs}). Use a new key for a new request.`,
        });
      expect(rerun.submit).not.toHaveBeenCalled();
    },
  );

  it.each<{
    name: string;
    error: () => Error;
    /** What the failed send itself returns, or `undefined` when it rethrows the error. */
    first?: ReturnType<typeof outcomeUnknown> | undefined;
    /** Truncates the record, as a crash while claiming the key would leave it. */
    truncate?: boolean | undefined;
    rerun: ReturnType<typeof outcomeUnknown>;
  }>([
    {
      name: "a send that failed without a transaction hash",
      error: () => new Error("socket hang up"),
      rerun: outcomeUnknown(
        `${label} with idempotency key "k1" may have been sent: another run with this key is still sending, or stopped before recording its outcome. Check the wallet balance before retrying with a new key.`,
        balanceCommand,
      ),
    },
    {
      name: "a claim interrupted while it was written",
      error: () => new Error("killed"),
      truncate: true,
      rerun: outcomeUnknown(
        `${label} with idempotency key "k1" may have been sent: another run with this key is still sending, or stopped before recording its outcome. Check the wallet balance before retrying with a new key.`,
        balanceCommand,
      ),
    },
    {
      name: "a receipt without a transaction hash",
      error: () => paymentOutcomeUnknownError("Receipt did not include a transaction hash."),
      first: outcomeUnknown("Receipt did not include a transaction hash.", balanceCommand),
      rerun: outcomeUnknown(
        `${label} with idempotency key "k1" may have been sent: another run with this key is still sending, or stopped before recording its outcome. Check the wallet balance before retrying with a new key.`,
        balanceCommand,
      ),
    },
    {
      name: "a send the node accepted but did not include before its timeout",
      // EIP-7966: code 4 with the transaction hash as data, wrapped by the client.
      error: () =>
        new Error("Transaction failed", {
          cause: Object.assign(new Error("not processed in time"), { code: 4, data: txHash }),
        }),
      first: outcomeUnknown(
        `${label} was submitted but did not confirm. ${checkTransaction}`,
        statusCommand,
      ),
      rerun: outcomeUnknown(
        `${label} with idempotency key "k1" was submitted, but its outcome was not recorded. ${checkTransaction}`,
        statusCommand,
      ),
    },
  ])("does not resend after $name", async ({ error, first, truncate, rerun: expected }) => {
    await useTempHome();
    const wallet = await login();
    const failure = error();
    const runtime = lookups({ submit: vi.fn(async () => Promise.reject(failure)) });

    const result = await send(wallet, { key: "k1" }, runtime).catch((value: unknown) => value);
    expect(result).toEqual(first ?? failure);
    const [file] = await recordFiles();
    if (truncate) await writeFile(join(idempotencyDir(), file!), "");
    const rerun = rerunLookups();

    expect(await send(wallet, { key: "k1" }, rerun)).toEqual(expected);
    expect(rerun.submit).not.toHaveBeenCalled();
  });

  it("frees the key when the send is refused before signing", async () => {
    await useTempHome();
    const wallet = await login();
    const refusal = walletError({ code: "E_NOT_AUTHENTICATED", message: "nothing was sent" });

    await expect(
      send(wallet, { key: "k1" }, lookups({ submit: vi.fn(async () => Promise.reject(refusal)) })),
    ).rejects.toBe(refusal);
    expect(await recordFiles()).toEqual([]);
    const retry = lookups();

    expect(await send(wallet, { key: "k1" }, retry)).toMatchObject({ status: "success" });
    expect(retry.submit).toHaveBeenCalledOnce();
  });

  it.each<{
    earlier: "sent" | "failed" | "none";
    expected: (sent: unknown, refusal: unknown) => unknown;
  }>([
    {
      earlier: "sent",
      expected: (sent) => ({ ...(sent as object), status: "success", idempotent_replay: true }),
    },
    {
      earlier: "failed",
      expected: () =>
        outcomeUnknown(
          `${label} with idempotency key "k1" may have been sent: another run with this key is still sending, or stopped before recording its outcome. Check the wallet balance before retrying with a new key.`,
          balanceCommand,
        ),
    },
    { earlier: "none", expected: (_, refusal) => refusal },
  ])(
    "resolves a key without a usable access key (earlier send: $earlier)",
    async ({ earlier, expected }) => {
      await useTempHome();
      const failed = vi.fn(async () => Promise.reject(new Error("socket hang up")));
      const sent =
        earlier === "none"
          ? undefined
          : await send(
              await login(),
              { key: "k1" },
              lookups(earlier === "failed" ? { submit: failed } : {}),
            ).catch(() => undefined);
      // The access key expires before the rerun, which an agent would refuse up front.
      const wallet = await login("mainnet", testWallet, 1);
      const refusal = missingKeyError(wallet)!;
      const rerun = rerunLookups();

      const result = await send(wallet, { key: "k1", keyRequired: refusal }, rerun);

      expect(refusal).toMatchObject({ code: "E_KEY_EXPIRED" });
      expect(result).toEqual(expected(sent, refusal));
      expect(rerun.submit).not.toHaveBeenCalled();
      expect(await recordFiles()).toHaveLength(earlier === "none" ? 0 : 1);
    },
  );

  it("flushes its claim to disk before sending", async () => {
    await useTempHome();
    const wallet = await login();
    const probe = await open(idempotencyDir().replace(/idempotency$/, ""), "r");
    const sync = vi.spyOn(Object.getPrototypeOf(probe) as { sync(): Promise<void> }, "sync");
    await probe.close();
    const runtime = lookups({
      submit: vi.fn(async () => {
        // The claim file, then its directory entry; Windows cannot sync a directory.
        expect(sync).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 2);
        return txHash;
      }),
    });

    expect(await send(wallet, { key: "k1" }, runtime)).toMatchObject({ status: "success" });
    expect(runtime.submit).toHaveBeenCalledOnce();
  });

  it("writes nothing on a dry run and carries the key into _next", async () => {
    await useTempHome();
    const wallet = await login();

    const dryRun = await send(wallet, { key: "k1", dryRun: true }, lookups());

    expect(dryRun).toMatchObject({ status: "dry_run" });
    const argv = (dryRun as { _next: { argv: string[] } })._next.argv;
    expect(
      argv.slice(argv.indexOf("--idempotency-key"), argv.indexOf("--idempotency-key") + 2),
    ).toEqual(["--idempotency-key", "k1"]);
    expect(await recordFiles()).toEqual([]);
    const runtime = lookups();
    expect(await send(wallet, { key: "k1" }, runtime)).toMatchObject({ status: "success" });
    expect(runtime.submit).toHaveBeenCalledOnce();
  });

  it.each([
    { scope: "another wallet", login: () => login("mainnet", testWallet2), sends: true },
    { scope: "another network", login: () => login("testnet"), sends: true },
    { scope: "the same wallet and network", login: () => login("mainnet"), sends: false },
  ])("scopes a key to its wallet and network: $scope", async ({ login: other, sends }) => {
    await useTempHome();
    await send(await login(), { key: "k1" }, lookups());
    const runtime = lookups();

    const result = await send(await other(), { key: "k1" }, runtime);

    expect(result).toMatchObject(sends ? { status: "success" } : { idempotent_replay: true });
    expect(runtime.submit).toHaveBeenCalledTimes(sends ? 1 : 0);
    expect(await recordFiles()).toHaveLength(sends ? 2 : 1);
  });

  it("sends again once the key's record has expired", async () => {
    await useTempHome();
    const wallet = await login();
    await createIdempotencyRecord(
      record({ key: "k1", created_at: nowSeconds() - 31 * day, request: { command: "other" } }),
    );
    const runtime = lookups();

    expect(await send(wallet, { key: "k1" }, runtime)).toMatchObject({ status: "success" });
    expect(runtime.submit).toHaveBeenCalledOnce();
  });

  it.skipIf(process.platform === "win32")("keeps records private to the owner", async () => {
    await useTempHome();
    await send(await login(), { key: "k1" }, lookups());

    const [file] = await recordFiles();
    expect((await stat(idempotencyDir())).mode & 0o777).toBe(0o700);
    expect((await stat(join(idempotencyDir(), file!))).mode & 0o777).toBe(0o600);
  });

  it.each(["", "k".repeat(256)])("rejects the key %j", async (key) => {
    await useTempHome();
    const wallet = await login();

    for (const dryRun of [true, false])
      await expect(send(wallet, { key, dryRun }, lookups())).rejects.toMatchObject({
        code: "E_USAGE",
        message: "Invalid --idempotency-key: expected 1 to 255 characters",
      });
  });

  it("names the balance check when the receipt has no transaction hash", async () => {
    await useTempHome();
    const { submit: _submit, ...runtime } = lookups();

    expect(await send(await login(), {}, runtime)).toEqual(
      outcomeUnknown(
        `${label} submitted but receipt did not include a transaction hash; check the wallet balance before retrying.`,
        balanceCommand,
      ),
    );
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});

function record(overrides: Partial<IdempotencyRecord>): IdempotencyRecord {
  return {
    key: "k1",
    wallet: testWallet.toLowerCase(),
    chain_id: 4217,
    request: { command: "transfer" },
    status: "success",
    tx_hash: txHash,
    created_at: nowSeconds(),
    result: { status: "success", tx_hash: txHash },
    ...overrides,
  };
}

describe("pruneIdempotencyRecords", () => {
  const now = 1_800_000_000;

  it.each([
    { name: "a record created 31 days ago", age: 31 * day, readable: true, kept: false },
    { name: "a record created 29 days ago", age: 29 * day, readable: true, kept: true },
    {
      name: "an unreadable record last written 31 days ago",
      age: 31 * day,
      readable: false,
      kept: false,
    },
    {
      name: "an unreadable record last written 29 days ago",
      age: 29 * day,
      readable: false,
      kept: true,
    },
  ])("prunes $name: kept $kept", async ({ age, readable, kept }) => {
    await useTempHome();
    await createIdempotencyRecord(record({ created_at: now - age }));
    const [file] = await recordFiles();
    const path = join(idempotencyDir(), file!);
    if (!readable) {
      await writeFile(path, "{");
      await utimes(path, now - age, now - age);
    }

    await pruneIdempotencyRecords(now);

    expect(await recordFiles()).toEqual(kept ? [file] : []);
  });

  it("keeps a claim another run makes while it prunes", async () => {
    await useTempHome();
    const now = nowSeconds();
    // An expired claim for k1, which another run reuses.
    await createIdempotencyRecord(
      record({ created_at: now - 31 * day, status: "submitting", tx_hash: null, result: null }),
    );
    const claim = record({ created_at: now, request: { command: "transfer", amount: "2" } });
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let other: Promise<boolean> | undefined;
    // Between this prune reading the expired record and deleting it, the other run prunes it too
    // and claims the key; unserialized, this prune's delete would remove that new claim.
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (other === undefined && String(path).endsWith(".json")) {
        other = pruneIdempotencyRecords(now).then(() => createIdempotencyRecord(claim));
        await sleep(200);
      }
      return actual.unlink(path);
    });
    try {
      await pruneIdempotencyRecords(now);
      expect(await other).toBe(true);
    } finally {
      vi.mocked(unlink).mockImplementation(actual.unlink);
    }

    expect(await loadIdempotencyRecord({ key: "k1", wallet: testWallet, chainId: 4217 })).toEqual(
      claim,
    );
    expect(await recordFiles()).toHaveLength(1);
  });

  it("does nothing before any record exists", async () => {
    await useTempHome();
    await expect(pruneIdempotencyRecords(now)).resolves.toBeUndefined();
  });
});
