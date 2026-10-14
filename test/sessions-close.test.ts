import { decodeFunctionData, type Hex } from "viem";
import { Channel as TempoChannel } from "viem/tempo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  request: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  // A zero block height leaves orphaned-channel discovery with nothing to scan.
  createPublicClient: vi.fn(({ chain }: { chain: { id: number } }) => ({
    getBlockNumber: async () => 0n,
    readContract: (call: object) => mocks.readContract({ ...call, chainId: chain.id }),
  })),
}));

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(() => ({ request: mocks.request })),
}));

import { closeSessions, dryRunCloseSessions, listSessions } from "../src/commands/sessions.js";
import { upsertSessionRecord } from "../src/payment/session-store.js";
import { escrowAbi, mainnetEscrow, moderatoEscrow, usdcToken } from "../src/shared/constants.js";
import {
  testAccessKey,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const channelId = `0x${"a".repeat(64)}`;
const otherChannelId = `0x${"b".repeat(64)}`;
const activeChannelId = `0x${"d".repeat(64)}`;
const origin = "https://service.example";
const otherOrigin = "https://other.example";
const activeOrigin = "https://active.example";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const now = Date.parse("2026-10-13T12:00:00Z") / 1000;
const mainnet = 4217;
const testnet = 42431;

beforeEach(async () => {
  vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  await useTempHome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  mocks.readContract.mockReset();
  mocks.request.mockReset();
});

describe("closing a session from another network", () => {
  it.each([
    {
      name: "a channel id from the logged-in network",
      chain: testnet,
      network: undefined,
      wallet: mainnet,
      target: channelId,
      message: `No session for ${channelId} on tempo; it is on tempo-moderato. Rerun with 'tempo wallet sessions close ${channelId}{flags} --network testnet'.`,
    },
    {
      name: "a channel id from --network",
      chain: mainnet,
      network: "testnet",
      wallet: mainnet,
      target: channelId,
      message: `No session for ${channelId} on tempo-moderato; it is on tempo. Rerun with 'tempo wallet sessions close ${channelId}{flags} --network mainnet'.`,
    },
    {
      name: "a URL",
      chain: testnet,
      network: "mainnet",
      wallet: testnet,
      target: `${origin}/v1/chat`,
      message: `No session for ${origin}/v1/chat on tempo; it is on tempo-moderato. Rerun with 'tempo wallet sessions close ${origin}/v1/chat{flags} --network testnet'.`,
    },
    {
      name: "a channel id with --finalize",
      chain: testnet,
      network: "mainnet",
      wallet: testnet,
      target: channelId,
      finalize: true,
      message: `No session for ${channelId} on tempo; it is on tempo-moderato. Rerun with 'tempo wallet sessions close ${channelId}{flags} --network testnet'.`,
    },
    {
      name: "a channel id with --cooperative",
      chain: testnet,
      network: "mainnet",
      wallet: testnet,
      target: channelId,
      cooperative: true,
      message: `No session for ${channelId} on tempo; it is on tempo-moderato. Rerun with 'tempo wallet sessions close ${channelId}{flags} --network testnet'.`,
    },
  ])(
    "refuses $name before any on-chain call and keeps the record",
    async ({ chain, network, wallet, target, finalize, cooperative, message }) => {
      await writeWalletState(stateFor(wallet));
      await saveSession(channelId, chain);

      // The rerun keeps the requested mode, so it performs the same operation on the right network.
      for (const close of [closeSessions, dryRunCloseSessions]) {
        const flags = [
          ...(finalize ? [" --finalize"] : []),
          ...(cooperative ? [" --cooperative"] : []),
          ...(close === dryRunCloseSessions ? [" --dry-run"] : []),
        ].join("");
        await expect(close({ cooperative, finalize, network, target })).rejects.toMatchObject({
          code: "E_USAGE",
          exitCode: 2,
          message: message.replace("{flags}", flags),
        });
      }

      expect(mocks.readContract).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(await sessionIds(chain)).toEqual([channelId]);
    },
  );

  it("closes only the selected network's sessions for an origin on both networks", async () => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet);
    await saveSession(otherChannelId, testnet);
    mockEscrow({ [channelId]: escrowChannel({ finalized: true }) });

    const result = await closeSessions({ network: "mainnet", target: origin });

    expect(result.results).toEqual([{ channel_id: channelId, status: "closed", origin }]);
    expect(chainsRead()).toEqual([mainnet]);
    expect(await sessionIds(testnet)).toEqual([otherChannelId]);
  });
});

describe("closing a channel the escrow no longer holds", () => {
  it.each([
    {
      name: "a finalized escrow channel removes the record",
      escrow: mainnetEscrow,
      onChain: escrowChannel({ finalized: true }),
      summary: { closed: 1, pending: 0, failed: 0 },
      result: { channel_id: channelId, status: "closed", origin },
      kept: [],
    },
    {
      name: "a missing escrow channel keeps the record",
      escrow: mainnetEscrow,
      onChain: escrowChannel({ deposit: 0n, payer: zeroAddress }),
      summary: { closed: 0, pending: 0, failed: 1 },
      result: {
        channel_id: channelId,
        status: "not_found",
        origin,
        error:
          "channel not found on tempo; kept the local session record (if the channel was already closed, 'tempo wallet sessions sync --network mainnet' removes it)",
      },
      kept: [channelId],
    },
    {
      name: "a zero-deposit precompile channel keeps the record",
      escrow: TempoChannel.address,
      onChain: { settled: 0n, deposit: 0n, closeRequestedAt: 0 },
      summary: { closed: 0, pending: 0, failed: 1 },
      result: expect.objectContaining({ channel_id: channelId, status: "not_found" }),
      kept: [channelId],
    },
  ])("$name", async ({ escrow, onChain, summary, result, kept }) => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet, { escrow_contract: escrow });
    mockEscrow({ [channelId]: onChain });

    const output = await closeSessions({ target: channelId });

    expect(output).toEqual({ ...summary, results: [result] });
    expect(chainsRead()).toEqual([mainnet]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await sessionIds(mainnet)).toEqual(kept);
  });

  it("reports an unknown channel id as not found instead of closed", async () => {
    await writeWalletState(stateFor(mainnet));
    mockEscrow({});

    expect(await closeSessions({ target: channelId })).toEqual({
      closed: 0,
      pending: 0,
      failed: 1,
      results: [
        { channel_id: channelId, status: "not_found", error: "channel not found on tempo" },
      ],
    });
  });
});

describe("--finalize", () => {
  it.each([
    { name: "a channel id", options: { target: channelId }, withdrawn: [channelId] },
    { name: "a URL", options: { target: `${origin}/v1/chat` }, withdrawn: [channelId] },
    { name: "no target", options: {}, withdrawn: [channelId, otherChannelId] },
    { name: "--all", options: { all: true }, withdrawn: [channelId, otherChannelId] },
  ])("with $name withdraws only its finalizable channels", async ({ options, withdrawn }) => {
    await writeWalletState(stateFor(mainnet));
    const closing = { state: "closing", close_requested_at: now - 1000, grace_ready_at: now - 100 };
    await saveSession(channelId, mainnet, closing);
    await saveSession(otherChannelId, mainnet, { ...closing, origin: otherOrigin });
    await saveSession(activeChannelId, mainnet, { origin: activeOrigin });
    mockEscrow({
      [channelId]: escrowChannel({ closeRequestedAt: now - 1000 }),
      [otherChannelId]: escrowChannel({ closeRequestedAt: now - 1000 }),
      [activeChannelId]: escrowChannel(),
    });
    mocks.request.mockResolvedValue({ transactionHash: `0x${"c".repeat(64)}` });

    const dryRun = await dryRunCloseSessions({ ...options, finalize: true });
    const result = await closeSessions({ ...options, finalize: true });

    expect(dryRun.targets).toEqual(
      withdrawn.map((id) => expect.objectContaining({ channel_id: id, state: "Finalizable" })),
    );
    expect(result).toMatchObject({ closed: withdrawn.length, pending: 0, failed: 0 });
    expect(withdrawals()).toEqual(
      withdrawn.map((id) => ({ functionName: "withdraw", args: [id] })),
    );
    expect(await sessionIds(mainnet)).toEqual(
      [channelId, otherChannelId, activeChannelId].filter((id) => !withdrawn.includes(id)),
    );
  });

  it.each([
    {
      name: "reports a channel whose close was never requested without requesting it",
      closeRequestedAt: 0,
      result: {
        channel_id: channelId,
        status: "error",
        origin,
        error: `close not requested; request it with 'tempo wallet sessions close ${channelId} --network mainnet'`,
      },
    },
    {
      name: "reports a channel still in its grace period as pending",
      closeRequestedAt: now - 100,
      result: { channel_id: channelId, status: "pending", origin, remaining_secs: 800 },
    },
  ])("with a target $name", async ({ closeRequestedAt, result }) => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet);
    mockEscrow({ [channelId]: escrowChannel({ closeRequestedAt }) });

    const output = await closeSessions({ finalize: true, target: channelId });

    expect(output.results).toEqual([result]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await sessionIds(mainnet)).toEqual([channelId]);
  });
});

describe("pending close instructions", () => {
  it.each([
    {
      name: "offer the cooperative close for a session with its server",
      sessions: [{ id: channelId, origin }],
      target: channelId,
      cooperative: `To close it now through its server instead, run 'tempo wallet sessions close ${channelId} --cooperative --network mainnet'.`,
    },
    {
      name: "offer the cooperative close for several sessions with their server",
      sessions: [
        { id: channelId, origin },
        { id: otherChannelId, origin },
      ],
      target: origin,
      cooperative: "To close one now through its server instead, add --cooperative to its command.",
    },
    {
      name: "omit the cooperative close for a discovered channel without a server",
      sessions: [{ id: channelId, origin: "" }],
      target: channelId,
      cooperative: undefined,
    },
  ])("$name", async ({ sessions, target, cooperative }) => {
    await writeWalletState(stateFor(mainnet));
    for (const session of sessions)
      await saveSession(session.id, mainnet, {
        origin: session.origin,
        request_url: session.origin && `${session.origin}/session`,
      });
    mockEscrow(
      Object.fromEntries(
        sessions.map((session) => [session.id, escrowChannel({ closeRequestedAt: now - 100 })]),
      ),
    );

    const result = (await closeSessions({ target })) as {
      pending: number;
      instruction: string;
      _next?: { argv: string[] };
    };

    expect(result.pending).toBe(sessions.length);
    if (cooperative) expect(result.instruction).toContain(cooperative);
    else expect(result.instruction).not.toContain("--cooperative");
    expect(result._next?.argv ?? []).not.toContain("--cooperative");
  });
});

function stateFor(chain: number) {
  const key = walletState().accessKeys[0]!;
  return walletState({ chainId: chain, accessKeys: [{ ...key, chainId: chain }] });
}

async function saveSession(
  id: string,
  chain: number,
  overrides: Partial<Parameters<typeof upsertSessionRecord>[0]> = {},
) {
  await upsertSessionRecord({
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey,
    chain_id: chain,
    challenge_echo: "{}",
    channel_id: id,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: chain === testnet ? moderatoEscrow : mainnetEscrow,
    grace_ready_at: 0,
    last_used_at: 1,
    network: chain === testnet ? "tempo-moderato" : "tempo",
    origin,
    payee: testWallet2,
    payer: testWallet,
    request_url: `${origin}/session`,
    salt: `0x${"0".repeat(64)}`,
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdcToken,
    ...overrides,
  });
}

/** Local session ids on `chain`, read without touching the chain. */
async function sessionIds(chain: number) {
  const { sessions } = await listSessions({ network: chain === testnet ? "testnet" : "mainnet" });
  return sessions.map((session) => session.channel_id).sort();
}

function escrowChannel(
  options: {
    finalized?: boolean;
    closeRequestedAt?: number;
    deposit?: bigint;
    payer?: string;
  } = {},
) {
  return [
    options.finalized ?? false,
    BigInt(options.closeRequestedAt ?? 0),
    options.payer ?? testWallet,
    testWallet2,
    usdcToken,
    testAccessKey,
    options.deposit ?? 10_000n,
    2_000n,
  ];
}

/** Escrow reads with a 900s grace period; channels not listed read as never opened. */
function mockEscrow(channels: Record<string, unknown>) {
  mocks.readContract.mockImplementation(
    async ({ functionName, args }: { functionName: string; args: [string] }) => {
      if (functionName === "CLOSE_GRACE_PERIOD") return 900n;
      return channels[args[0]] ?? escrowChannel({ deposit: 0n, payer: zeroAddress });
    },
  );
}

function chainsRead() {
  return [
    ...new Set(
      mocks.readContract.mock.calls.map(([call]) => (call as { chainId: number }).chainId),
    ),
  ];
}

function withdrawals() {
  return mocks.request.mock.calls.map(([{ params }]) => {
    const [request] = params as [{ calls: [{ data: Hex }] }];
    const { functionName, args } = decodeFunctionData({
      abi: escrowAbi,
      data: request.calls[0].data,
    });
    return { functionName, args };
  });
}
