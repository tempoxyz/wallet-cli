import type { z } from "incur";

import { nonDestructive } from "../../cli/command.js";
import { sessionsListOptions, sessionsListOutput } from "../../schemas/sessions.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { networkFields, resolveNetwork, type Network } from "../../shared/network.js";
import {
  discoverAndPersistOrphanedChannels,
  readChannelRecords,
  sessionItem,
  sessionStatus,
  unspentDeposit,
} from "./records.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type ListContext = {
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof sessionsListOptions>;
};

export const listCommand = {
  description: "List payment sessions",
  options: sessionsListOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ globals, options }: ListContext) {
    return listSessions({
      all: options.all,
      network: globals.network,
      orphaned: options.orphaned,
    });
  },
};

// With `all` or `orphaned`, stores channels discovered on-chain that were not stored yet.
export const listAnnotations = { ...nonDestructive, idempotentHint: true, openWorldHint: true };

export async function listSessions(
  options: {
    all?: boolean | undefined;
    network?: string | undefined;
    orphaned?: boolean | undefined;
  } = {},
) {
  return sessionList(await resolveNetwork(options.network), options);
}

export async function sessionList(
  network: Network,
  options: { all?: boolean | undefined; orphaned?: boolean | undefined },
) {
  const records =
    options.all || options.orphaned
      ? await discoverAndPersistOrphanedChannels(network)
      : await readChannelRecords();
  const sessions = records
    .filter((record) => record.chain_id === network.chainId)
    .map(sessionItem)
    .filter((record) => record.status !== "finalized")
    .filter((record) => (options.orphaned && !options.all ? record.status === "orphaned" : true));

  return {
    ...networkFields(network.chainId),
    sessions,
    total: sessions.length,
  };
}

/**
 * Stored sessions paid by one of `payers`, on `chainId` when it is set, whose deposit still holds
 * unspent funds: every session not finalized, as `sessions list` reports it.
 */
export async function fundedSessions(options: {
  payers: readonly string[];
  chainId?: number | undefined;
}) {
  const payers = new Set(options.payers.map((payer) => payer.toLowerCase()));
  return (await readChannelRecords())
    .filter(
      (record) =>
        payers.has(record.payer) &&
        (options.chainId === undefined || record.chain_id === options.chainId) &&
        sessionStatus(record) !== "finalized" &&
        unspentDeposit(record) > 0n,
    )
    .map(sessionItem);
}
