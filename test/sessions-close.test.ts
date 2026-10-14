import { createServer } from "node:http";

import { Challenge, Credential } from "mppx";
import { decodeFunctionData, type Hex } from "viem";
import { Channel as TempoChannel } from "viem/tempo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  getLogs: vi.fn(),
  readContract: vi.fn(),
  request: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  // A zero block height leaves orphaned-channel discovery with nothing to scan.
  createPublicClient: vi.fn(({ chain }: { chain: { id: number } }) => ({
    getBlockNumber: async () => 0n,
    getLogs: (call: object) => mocks.getLogs({ ...call, chainId: chain.id }),
    readContract: (call: object) => mocks.readContract({ ...call, chainId: chain.id }),
  })),
}));

// A paid request signs its session credential through this stub and sees a funded wallet.
vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: () => ({
        createCredential: mocks.createCredential,
        transport: {
          setCredential: (init: RequestInit, credential: string) => ({
            ...init,
            headers: { authorization: credential },
          }),
        },
      }),
    },
  };
});

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getBalance: async () => ({ amount: 1_000_000n }) },
    },
  };
});

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(() => ({ request: mocks.request })),
}));

import { runRequest } from "../src/commands/request.js";
import { closeSessions, dryRunCloseSessions, listSessions } from "../src/commands/sessions.js";
import { readSessionRecordsByOrigin, upsertSessionRecord } from "../src/payment/session-store.js";
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
  mocks.getLogs.mockResolvedValue([]);
  await useTempHome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.createCredential.mockReset();
  mocks.getLogs.mockReset();
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
      name: "a closed precompile channel removes the record",
      escrow: TempoChannel.address,
      onChain: precompileState(0n),
      closedLog: true,
      summary: { closed: 1, pending: 0, failed: 0 },
      result: { channel_id: channelId, status: "closed", origin },
      kept: [],
    },
    {
      name: "an active zero-deposit precompile channel without ChannelClosed keeps the record",
      escrow: TempoChannel.address,
      onChain: precompileState(0n),
      summary: { closed: 0, pending: 0, failed: 1 },
      result: expect.objectContaining({ channel_id: channelId, status: "not_found" }),
      kept: [channelId],
    },
    {
      name: "a cleared precompile channel whose cooperative close was requested removes the record",
      escrow: TempoChannel.address,
      session: { state: "closing", close_requested_at: now - 100, grace_ready_at: 0 },
      onChain: precompileState(0n),
      summary: { closed: 1, pending: 0, failed: 0 },
      result: { channel_id: channelId, status: "closed", origin },
      kept: [],
    },
    {
      name: "a cleared precompile channel past its grace period removes the record",
      escrow: TempoChannel.address,
      session: { state: "finalizable", close_requested_at: now - 1000, grace_ready_at: now - 100 },
      onChain: precompileState(0n),
      summary: { closed: 1, pending: 0, failed: 0 },
      result: { channel_id: channelId, status: "closed", origin },
      kept: [],
    },
  ])("$name", async ({ escrow, session, onChain, closedLog, summary, result, kept }) => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet, { escrow_contract: escrow, ...session });
    mockEscrow({ [channelId]: onChain });
    if (closedLog) mocks.getLogs.mockResolvedValue([channelClosedLog()]);

    const output = await closeSessions({ target: channelId });

    expect(output).toEqual({ ...summary, results: [result] });
    expect(chainsRead()).toEqual([mainnet]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await sessionIds(mainnet)).toEqual(kept);
  });

  it("removes a v2 record whose payee closed the channel after its close was requested", async () => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet, {
      descriptor_json: JSON.stringify(sessionDescriptor()),
      escrow_contract: TempoChannel.address,
      session_protocol: "v2",
    });
    mockEscrow({ [channelId]: precompileState(10_000n) });
    mocks.request.mockResolvedValue({ transactionHash: `0x${"c".repeat(64)}`, status: "0x1" });

    const requested = await closeSessions({ target: channelId });
    // The payee closes the channel: the precompile clears it, and no ChannelClosed log is found.
    mockEscrow({ [channelId]: precompileState(0n) });
    const rerun = await closeSessions({ target: channelId });

    expect(requested).toMatchObject({ pending: 1, results: [{ status: "pending" }] });
    expect(rerun).toEqual({
      closed: 1,
      pending: 0,
      failed: 0,
      results: [{ channel_id: channelId, status: "closed", origin }],
    });
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(await sessionIds(mainnet)).toEqual([]);
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

describe("--cooperative", () => {
  const v2Session = {
    descriptor_json: JSON.stringify(sessionDescriptor()),
    escrow_contract: TempoChannel.address,
    session_protocol: "v2",
  };

  it.each([
    {
      name: "removes a v1 record once the escrow shows the channel finalized",
      v2: false,
      after: escrowChannel({ finalized: true }),
      closedLog: false,
      status: "closed",
    },
    {
      name: "keeps a v1 record while the escrow still shows the channel open",
      v2: false,
      after: escrowChannel(),
      closedLog: false,
      status: "requested",
    },
    {
      name: "removes a v2 record once the precompile logs ChannelClosed",
      v2: true,
      after: precompileState(0n),
      closedLog: true,
      status: "closed",
    },
    {
      name: "keeps a v2 record and its descriptor while the precompile still holds the deposit",
      v2: true,
      after: precompileState(10_000n),
      closedLog: false,
      status: "requested",
    },
    {
      name: "keeps a v2 record and its descriptor when the cleared channel logged no ChannelClosed",
      v2: true,
      after: precompileState(0n),
      closedLog: false,
      status: "requested",
    },
  ])("$name after the server accepts the close", async ({ v2, after, closedLog, status }) => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet, {
      challenge_echo: sessionChallenge(),
      ...(v2 ? v2Session : {}),
    });
    let acceptedByServer = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const authorized = Boolean(
          (init?.headers as Record<string, string> | undefined)?.Authorization,
        );
        acceptedByServer ||= authorized;
        return new Response(null, { status: authorized ? 204 : 503 });
      }),
    );
    const before = v2 ? precompileState(10_000n) : escrowChannel();
    mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "CLOSE_GRACE_PERIOD" ? 900n : acceptedByServer ? after : before,
    );
    mocks.getLogs.mockImplementation(async ({ address, args }) =>
      acceptedByServer &&
      closedLog &&
      address === TempoChannel.address &&
      args.channelId === channelId
        ? [channelClosedLog()]
        : [],
    );

    const result = await closeSessions({ cooperative: true, target: channelId });
    const [stored] = await readSessionRecordsByOrigin(origin);

    expect(acceptedByServer).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
    if (status === "closed") {
      expect(result).toEqual({
        closed: 1,
        pending: 0,
        failed: 0,
        results: [{ channel_id: channelId, status, origin }],
      });
      expect(stored).toBeUndefined();
    } else {
      expect(result).toMatchObject({
        closed: 0,
        pending: 1,
        failed: 0,
        results: [{ channel_id: channelId, status, origin }],
        instruction: expect.stringContaining("its local record was kept"),
        _next: {
          argv: ["tempo", "wallet", "sessions", "close", channelId, "--network", "mainnet"],
          until: ".pending == 0 and .failed == 0",
        },
      });
      expect(stored).toMatchObject({
        channel_id: channelId,
        descriptor_json: v2 ? v2Session.descriptor_json : undefined,
        state: "closing",
        close_requested_at: now,
        grace_ready_at: 0,
      });
    }
  });

  it("requests the close on-chain when a rerun finds the channel the server accepted still open", async () => {
    await writeWalletState(stateFor(mainnet));
    await saveSession(channelId, mainnet, { challenge_echo: sessionChallenge() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const authorized = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return new Response(null, { status: authorized ? 204 : 503 });
      }),
    );
    mockEscrow({ [channelId]: escrowChannel() });
    mocks.request.mockResolvedValue({ transactionHash: `0x${"c".repeat(64)}`, status: "0x1" });

    await closeSessions({ cooperative: true, target: channelId });
    const rerun = await closeSessions({ target: channelId });

    expect(rerun.results).toEqual([
      { channel_id: channelId, status: "pending", origin, remaining_secs: 900 },
    ]);
    expect(withdrawals()).toEqual([{ functionName: "requestClose", args: [channelId] }]);
    expect(await readSessionRecordsByOrigin(origin)).toEqual([
      expect.objectContaining({
        state: "closing",
        close_requested_at: now,
        grace_ready_at: now + 900,
      }),
    ]);
  });

  it("opens a new channel for a later payment instead of reusing one whose close was requested", async () => {
    await writeWalletState(stateFor(mainnet));
    const challenge = Challenge.from({
      id: "reuse-test",
      realm: "service",
      method: "tempo",
      intent: "session",
      request: {
        amount: "1000",
        currency: usdcToken,
        methodDetails: { chainId: mainnet, sessionProtocol: "v2" },
        recipient: testWallet2,
      },
    });
    const paid: string[] = [];
    const server = createServer((request, response) => {
      const authorization = request.headers.authorization;
      if (authorization) paid.push(authorization);
      else response.setHeader("www-authenticate", Challenge.serialize(challenge));
      response.statusCode = authorization ? 200 : 402;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing server address");
    const service = `http://127.0.0.1:${address.port}`;
    try {
      await saveSession(channelId, mainnet, {
        ...v2Session,
        origin: service,
        request_url: `${service}/session`,
        challenge_echo: JSON.stringify(challenge),
      });
      // The server accepts the close but the precompile still holds the deposit.
      mockEscrow({ [channelId]: precompileState(10_000n) });
      mocks.createCredential.mockResolvedValue(
        Credential.serialize({ challenge, payload: { channelId: otherChannelId } }),
      );

      const close = await closeSessions({ cooperative: true, target: channelId });
      await runRequest([`${service}/paid`], { stdout: { write: () => true } as never });

      expect(close.results).toEqual([
        { channel_id: channelId, status: "requested", origin: service },
      ]);
      // The payment opened a channel rather than signing a voucher on the one being closed.
      expect(mocks.createCredential).toHaveBeenCalledOnce();
      expect(mocks.createCredential.mock.calls[0]![1]).toEqual({ depositRaw: expect.any(String) });
      expect(paid).toHaveLength(2);
      expect(
        (await readSessionRecordsByOrigin(service)).map(({ channel_id, state }) => ({
          channel_id,
          state,
        })),
      ).toEqual(
        expect.arrayContaining([
          { channel_id: channelId, state: "closing" },
          { channel_id: otherChannelId, state: "active" },
        ]),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("pending close instructions", () => {
  it.each([
    {
      name: "offer the cooperative close for a session with its server",
      sessions: [{ id: channelId, origin, escrow: mainnetEscrow }],
      target: channelId,
      cooperative: `To close it now through its server instead, run 'tempo wallet sessions close ${channelId} --cooperative --network mainnet'.`,
    },
    {
      name: "offer the cooperative close for several sessions with their server",
      sessions: [
        { id: channelId, origin, escrow: mainnetEscrow },
        { id: otherChannelId, origin, escrow: mainnetEscrow },
      ],
      target: origin,
      cooperative: "To close one now through its server instead, add --cooperative to its command.",
    },
    {
      name: "omit the cooperative close for a discovered channel without a server",
      sessions: [{ id: channelId, origin: "", escrow: mainnetEscrow }],
      target: channelId,
      cooperative: undefined,
    },
    {
      name: "omit the cooperative close for a v2 session, which servers refuse once a close is requested",
      sessions: [{ id: channelId, origin, escrow: TempoChannel.address }],
      target: channelId,
      cooperative: undefined,
    },
  ])("$name", async ({ sessions, target, cooperative }) => {
    await writeWalletState(stateFor(mainnet));
    for (const session of sessions)
      await saveSession(session.id, mainnet, {
        origin: session.origin,
        request_url: session.origin && `${session.origin}/session`,
        escrow_contract: session.escrow,
        descriptor_json: JSON.stringify(sessionDescriptor()),
      });
    mockEscrow(
      Object.fromEntries(
        sessions.map((session) => [
          session.id,
          session.escrow === TempoChannel.address
            ? precompileState(10_000n, now - 100)
            : escrowChannel({ closeRequestedAt: now - 100 }),
        ]),
      ),
    );

    const result = await closeSessions({ target });

    expect(result).toMatchObject({
      pending: sessions.length,
      instruction: cooperative
        ? expect.stringContaining(cooperative)
        : expect.not.stringContaining("--cooperative"),
    });
    expect(result).not.toHaveProperty(["_next", "argv"], expect.arrayContaining(["--cooperative"]));
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

/** The precompile's `getChannelState`, which clears a closed channel to a zero deposit. */
function precompileState(deposit: bigint, closeRequestedAt = 0) {
  return { settled: deposit === 0n ? 0n : 2_000n, deposit, closeRequestedAt };
}

function channelClosedLog() {
  return { address: TempoChannel.address, args: { channelId }, eventName: "ChannelClosed" };
}

function sessionDescriptor() {
  return {
    authorizedSigner: testAccessKey,
    expiringNonceHash: `0x${"3".repeat(64)}`,
    operator: zeroAddress,
    payee: testWallet2,
    payer: testWallet,
    salt: `0x${"4".repeat(64)}`,
    token: usdcToken,
  };
}

function sessionChallenge() {
  return JSON.stringify(
    Challenge.from({
      id: "close-test",
      realm: origin,
      method: "tempo",
      intent: "session",
      request: { amount: "1000", currency: usdcToken, recipient: testWallet2 },
    }),
  );
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
