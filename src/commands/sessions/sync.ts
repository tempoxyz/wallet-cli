import type { z } from "incur";
import type { Address, Hex } from "viem";

import { destructive } from "../../cli/command.js";
import { option } from "../../cli/describe.js";
import { sessionsListOutput, sessionsSyncOptions } from "../../schemas/sessions.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { escrowContract, resolveNetwork } from "../../shared/network.js";
import { normalizeOrigin } from "../../shared/utils.js";
import { getOnChainChannel, readGracePeriod } from "../../payment/channel.js";
import { sessionList } from "./list.js";
import {
  deleteChannelRecord,
  readChannelRecords,
  sessionStateFromCloseTiming,
  updateChannelCloseState,
} from "./records.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type SyncContext = {
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof sessionsSyncOptions>;
};

export const syncCommand = {
  description: "Sync local sessions with on-chain state",
  options: sessionsSyncOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ globals, options }: SyncContext) {
    return syncSessions({ network: globals.network, origin: options.origin });
  },
};

// Deletes stored sessions whose channel the chain shows finalized or does not hold.
export const syncAnnotations = { ...destructive, idempotentHint: true, openWorldHint: true };

export const syncDescribe = {
  name: "sync",
  about: "Sync local sessions with on-chain state",
  args: [
    option("origin", "--origin", "Re-sync a specific origin's close state from on-chain", {
      valueName: "ORIGIN",
    }),
  ],
};

export async function syncSessions(options: {
  network?: string | undefined;
  origin?: string | undefined;
}) {
  const network = await resolveNetwork(options.network);
  const chain = network.chainId;
  const records = (await readChannelRecords()).filter((record) => record.chain_id === chain);
  const selected = options.origin
    ? records.filter((record) => record.origin === normalizeOrigin(options.origin ?? ""))
    : records;

  for (const record of selected) {
    const onChain = await getOnChainChannel({
      channelId: record.channel_id as Hex,
      escrowContract: (record.escrow_contract || escrowContract(chain)) as Address,
      network,
    });
    if (!onChain || onChain.finalized) {
      await deleteChannelRecord(record.channel_id);
      continue;
    }

    if (onChain.closeRequestedAt > 0n) {
      const gracePeriod = await readGracePeriod({
        escrowContract: (record.escrow_contract || escrowContract(chain)) as Address,
        network,
      });
      await updateChannelCloseState({
        channelId: record.channel_id,
        closeRequestedAt: Number(onChain.closeRequestedAt),
        graceReadyAt: Number(onChain.closeRequestedAt + BigInt(gracePeriod)),
        state: sessionStateFromCloseTiming(Number(onChain.closeRequestedAt), gracePeriod),
      });
    }
  }

  return sessionList(network, {});
}
