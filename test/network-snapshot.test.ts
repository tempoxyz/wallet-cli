import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadWalletState: vi.fn() }));
vi.mock("../src/wallet/store.js", async (original) => ({
  ...(await original<typeof import("../src/wallet/store.js")>()),
  loadWalletState: mocks.loadWalletState,
}));

import { doctorHandler } from "../src/commands/doctor.js";
import { revokeHandler } from "../src/commands/revoke.js";
import { whoamiHandler } from "../src/commands/whoami.js";
import { fundAction, runFundingFlow } from "../src/commands/fund.js";
import { syncSessions } from "../src/commands/sessions/sync.js";
import { swapTokens } from "../src/commands/swap.js";
import { transferCredits } from "../src/commands/transfer/credits.js";
import { transferTokens } from "../src/commands/transfer/tokens.js";
import { moderatoToken } from "../src/shared/constants.js";
import {
  readyWallet,
  runContext,
  testAccessKey,
  testWallet2,
  useTempHome,
  walletState,
} from "./helpers.js";

const testnet = { chain_id: 42431, network: "tempo-moderato" };

beforeEach(async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // The first read sees a testnet login; any later read sees the wallet logged out.
  mocks.loadWalletState
    .mockResolvedValueOnce(
      walletState({
        chainId: 42431,
        accessKeys: [{ ...walletState().accessKeys[0]!, chainId: 42431 }],
      }),
    )
    .mockResolvedValue({ accounts: [], accessKeys: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.loadWalletState.mockReset();
});

it.each<{ command: string; run: () => Promise<unknown>; continues?: boolean }>([
  { command: "sessions sync", run: () => syncSessions({}) },
  { command: "whoami", run: () => whoamiHandler({}) },
  { command: "doctor", run: () => doctorHandler({}) },
  {
    command: "revoke --dry-run",
    run: async () =>
      revokeHandler(
        await readyWallet(),
        { accessKey: testAccessKey },
        { "dry-run": true },
        runContext(),
      ),
    continues: true,
  },
  {
    command: "transfer --dry-run",
    run: async () =>
      transferTokens(
        await readyWallet(),
        {
          args: { amount: "1", token: moderatoToken, to: testWallet2 },
          options: { "dry-run": true },
        },
        {
          getBalance: async () => 1_000_000n,
          estimateFee: async () => 175n,
          getUserFeeToken: async () => null,
        },
      ),
    continues: true,
  },
  {
    command: "transfer --credits --dry-run",
    run: () =>
      transferCredits({ options: { "amount-cents": 100, to: testWallet2, "dry-run": true } }),
  },
  {
    command: "swap --dry-run",
    continues: true,
    run: async () =>
      swapTokens(
        await readyWallet(),
        {
          args: { amount: "1", tokenIn: moderatoToken, tokenOut: testWallet2 },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        {
          getBalance: async () => 100_000_000n,
          getMetadata: async () => ({ decimals: 6, symbol: "TOKEN" }),
          getSellQuote: async () => 1_000_000n,
        },
      ),
  },
  {
    command: "fund --no-wait",
    run: () => runFundingFlow({ action: fundAction({}), noBrowser: true, noWait: true }),
  },
])("$command resolves its network from one wallet snapshot", async ({ run, continues }) => {
  const result = await run();

  expect(result).toMatchObject(testnet);
  // A continuation must target the same network the command ran against.
  expect((result as { _next?: { argv: string[] } })._next?.argv.slice(-2)).toEqual(
    continues ? ["--network", "testnet"] : undefined,
  );
});
