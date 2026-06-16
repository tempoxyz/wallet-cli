import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";

import {
  buildSessionManagementTransactionRequest,
  dryRunCloseSessions,
  listSessions,
} from "../src/commands/sessions.js";
import { handleCompatCommand } from "../src/compat.js";

import { expectUsageError, testAccessKey, testWallet, useTempHome } from "./helpers.js";

const validChannelId = `0x${"a".repeat(64)}`;

describe("sessions utilities", () => {
  it("lists no sessions when the local channel store is empty", async () => {
    await useTempHome();

    expect(await listSessions()).toEqual({ sessions: [], total: 0 });
  });

  it("rejects a dry-run close with no target via E_USAGE", async () => {
    await useTempHome();

    await expect(dryRunCloseSessions({})).rejects.toMatchObject({ code: "E_USAGE" });
    await dryRunCloseSessions({}).catch((error) =>
      expectUsageError(
        error,
        "Specify a URL, channel ID (0x...), or use --all/--orphaned/--finalize to close sessions",
      ),
    );
  });

  it("returns a bare channel target for a dry-run close of an unknown channel id", async () => {
    await useTempHome();

    expect(await dryRunCloseSessions({ target: validChannelId })).toEqual({
      targets: [{ channel_id: validChannelId }],
    });
  });

  it("rejects cooperative combined with --all/--orphaned/--finalize via E_USAGE", async () => {
    await useTempHome();

    const message = "--cooperative cannot be combined with --all, --orphaned, or --finalize";
    for (const combo of [
      { cooperative: true, all: true },
      { cooperative: true, orphaned: true },
      { cooperative: true, finalize: true },
    ]) {
      await dryRunCloseSessions(combo).then(
        () => {
          throw new Error("expected dryRunCloseSessions to throw");
        },
        (error) => expectUsageError(error, message),
      );
    }
  });

  it("builds v2 close transactions with descriptor calldata and token fees", () => {
    const descriptor = sessionDescriptor();
    const request = buildSessionManagementTransactionRequest({
      channelId: validChannelId as `0x${string}`,
      escrowContract: TempoChannel.address,
      functionName: "requestClose",
      record: {
        accepted_cumulative: 1_000n,
        authorized_signer: testAccessKey,
        chain_id: 4217,
        challenge_echo: "{}",
        channel_id: validChannelId,
        close_requested_at: 0,
        created_at: 1,
        cumulative_amount: 1_000n,
        deposit: 1_000n,
        descriptor_json: JSON.stringify(descriptor),
        escrow_contract: TempoChannel.address,
        grace_ready_at: 0,
        last_used_at: 1,
        network: "tempo",
        origin: "https://rpc.mpp.tempo.xyz",
        payer: testWallet,
        request_url: "https://rpc.mpp.tempo.xyz/",
        session_protocol: "v2",
        state: "active",
        token: descriptor.token,
      },
    });

    expect(request.feeToken).toBe(descriptor.token);
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0]?.to.toLowerCase()).toBe(TempoChannel.address.toLowerCase());

    const decoded = decodeFunctionData({
      abi: TempoAbis.tip20ChannelReserve,
      data: request.calls[0]!.data,
    });
    expect(decoded.functionName).toBe("requestClose");
    expect(normalizeDescriptor(decoded.args[0])).toEqual(normalizeDescriptor(descriptor));
  });
});

function sessionDescriptor() {
  return {
    authorizedSigner: testAccessKey,
    expiringNonceHash: `0x${"3".repeat(64)}` as `0x${string}`,
    operator: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    payee: "0x0000000000000000000000000000000000000ccc" as `0x${string}`,
    payer: testWallet,
    salt: `0x${"4".repeat(64)}` as `0x${string}`,
    token: "0x0000000000000000000000000000000000000ddd" as `0x${string}`,
  };
}

function normalizeDescriptor(value: unknown) {
  const descriptor = value as ReturnType<typeof sessionDescriptor>;
  return {
    ...descriptor,
    authorizedSigner: descriptor.authorizedSigner.toLowerCase(),
    operator: descriptor.operator.toLowerCase(),
    payee: descriptor.payee.toLowerCase(),
    payer: descriptor.payer.toLowerCase(),
    token: descriptor.token.toLowerCase(),
  };
}

describe("compat completions", () => {
  it("lists supported shells when no shell is provided", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions"])).toBe(true);
    expect(log).toHaveBeenCalledWith("Supported shells: bash, zsh, fish, powershell, elvish");
  });

  it("prints a powershell completion script", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions", "powershell"])).toBe(true);
    const output = log.mock.calls[0]?.[0] as string;
    expect(output).toContain("Register-ArgumentCompleter");
    expect(output).toContain("CommandName 'tempo wallet'");
  });

  it("prints an elvish completion script", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await handleCompatCommand(["completions", "elvish"])).toBe(true);
    const output = log.mock.calls[0]?.[0] as string;
    expect(output).toContain("edit:completion:arg-completer[tempo wallet]");
    expect(output).toContain("cand login");
  });
});
