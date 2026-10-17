import { createServer } from "node:http";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { logoutHandler } from "../src/commands/logout.js";
import { revokeHandler } from "../src/commands/keys.js";
import { closeSessions, dryRunCloseSessions } from "../src/commands/sessions/close.js";
import { readChannelRecords } from "../src/commands/sessions/records.js";
import { syncSessions } from "../src/commands/sessions/sync.js";
import { planSessionPayment } from "../src/request/session.js";
import type { RequestOptions } from "../src/request/options.js";
import type { SessionDetails } from "../src/request/challenge.js";
import { mainnetEscrow } from "../src/shared/constants.js";
import { requireRpcChain } from "../src/shared/network.js";
import { upsertSessionRecord } from "../src/payment/session-store.js";
import { saveConfigValue, withConfigSnapshot } from "../src/wallet/config.js";
import { loadWalletState, saveWalletState } from "../src/wallet/store.js";
import {
  readyWallet,
  runContext,
  testAccessKey,
  testWallet,
  testWallet2,
  usdc,
  useTempHome,
  walletApp,
  walletState,
} from "./helpers.js";

const channelId = `0x${"a".repeat(64)}`;
const origin = "https://service.example";

/** A JSON-RPC endpoint on testnet that records each method it is asked and answers no other. */
async function testnetRpc() {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      methods.push(method);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          method === "eth_chainId"
            ? { jsonrpc: "2.0", id, result: "0xa5bf" }
            : { jsonrpc: "2.0", id, error: { code: -32000, message: "unexpected" } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    methods,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let rpc: Awaited<ReturnType<typeof testnetRpc>>;

beforeEach(async () => {
  rpc = await testnetRpc();
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rpc.close();
});

/** A funded mainnet session the logged-in wallet's access key pays from. */
const session = {
  accepted_cumulative: 1_000n,
  authorized_signer: testAccessKey.toLowerCase(),
  chain_id: 4217,
  challenge_echo: "{}",
  channel_id: channelId,
  close_requested_at: 0,
  created_at: 1,
  cumulative_amount: 1_000n,
  deposit: 10_000_000n,
  escrow_contract: mainnetEscrow,
  grace_ready_at: 0,
  last_used_at: 1,
  network: "tempo",
  origin,
  payee: testWallet2.toLowerCase(),
  payer: testWallet.toLowerCase(),
  request_url: `${origin}/paid`,
  salt: `0x${"0".repeat(64)}`,
  server_spent: 1_000n,
  session_protocol: "v1",
  state: "active",
  token: usdc.toLowerCase(),
};

const expiredKey = { ...walletState().accessKeys[0]!, expiry: 1 };

// Each path would delete, close, or revoke on what a mainnet read returns, so an endpoint on
// testnet is refused before anything is read, sent, or changed.
it.each([
  {
    path: "session reuse",
    run: () =>
      planSessionPayment(
        {
          amount: 1_000n,
          chainId: 4217,
          escrowContract: mainnetEscrow,
          origin,
          payee: session.payee,
          token: session.token,
        } as SessionDetails,
        { address: testWallet, signerAddress: testAccessKey },
        { url: `${origin}/paid` } as RequestOptions,
      ),
  },
  { path: "sessions sync", run: () => syncSessions({ network: "mainnet" }) },
  {
    path: "sessions close",
    run: async () =>
      closeSessions(await readyWallet("mainnet"), { target: channelId, yes: true }, runContext()),
  },
  {
    path: "sessions close --dry-run",
    run: async () => dryRunCloseSessions(await readyWallet("mainnet"), { target: channelId }),
  },
  {
    path: "sessions close --finalize",
    run: async () =>
      closeSessions(
        await readyWallet("mainnet"),
        { target: channelId, finalize: true, yes: true },
        runContext(),
      ),
  },
  {
    path: "logout --revoke of an expired key",
    keys: [expiredKey],
    run: (app: ReturnType<typeof walletApp>) =>
      logoutHandler({ revoke: true, yes: true }, runContext(), {
        createProvider: app.createProvider,
      }),
  },
  {
    path: "logout --revoke",
    run: (app: ReturnType<typeof walletApp>) =>
      logoutHandler({ revoke: true, yes: true }, runContext(), {
        createProvider: app.createProvider,
      }),
  },
  {
    path: "revoke",
    run: async (app: ReturnType<typeof walletApp>) =>
      revokeHandler(
        await readyWallet("mainnet", false),
        { accessKey: testAccessKey },
        { yes: true },
        runContext(),
        { createProvider: app.createProvider },
      ),
  },
] as const)(
  "$path refuses a TEMPO_RPC_URL on another chain, keeping every record and key",
  async ({ run, ...row }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_RPC_URL", rpc.url);
    await saveWalletState(walletState("keys" in row ? { accessKeys: [...row.keys] } : {}));
    await upsertSessionRecord(session);
    const before = { sessions: await readChannelRecords(), wallet: await loadWalletState() };
    const app = walletApp();

    // A refusal is thrown, or, where logout reports a key it could not revoke, returned.
    expect(await run(app).catch((error: unknown) => error)).toMatchObject({
      code: "E_USAGE",
      retryable: false,
      message: expect.stringContaining(
        "TEMPO_RPC_URL is on tempo-moderato (chain 42431), not tempo (chain 4217), so nothing was read, changed, or revoked. Check the endpoint with 'tempo wallet config get rpc-url'.",
      ),
    });
    expect({ sessions: await readChannelRecords(), wallet: await loadWalletState() }).toEqual(
      before,
    );
    expect(app.request).not.toHaveBeenCalled();
    expect(rpc.methods).toEqual(["eth_chainId"]);
  },
);

it("checks an rpc-url saved for a network against its chain, as a safety net", async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_RPC_URL", undefined);
  // Saved for mainnet once it answered there, the endpoint has since moved to testnet.
  await saveConfigValue("rpc-url", rpc.url, { network: "mainnet" });

  await expect(requireRpcChain(4217)).rejects.toMatchObject({
    code: "E_USAGE",
    message: expect.stringContaining(
      "The saved rpc-url for tempo is on tempo-moderato (chain 42431), not tempo (chain 4217)",
    ),
  });
  // Testnet has no override, so its default endpoint needs no check.
  await expect(requireRpcChain(42431)).resolves.toBeUndefined();
  expect(rpc.methods).toEqual(["eth_chainId"]);
});

it("asks the endpoint's chain once per command", async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_RPC_URL", rpc.url);

  await withConfigSnapshot(async () => {
    await requireRpcChain(42431);
    await requireRpcChain(42431);
  });
  await requireRpcChain(42431);

  expect(rpc.methods).toEqual(["eth_chainId", "eth_chainId"]);
});
