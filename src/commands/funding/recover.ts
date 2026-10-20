import type { z } from "incur";
import type { CrossChainOperation } from "machine-fetch/interfaces/evm";

import { nonDestructive } from "../../cli/command.js";
import { loadAttempt, removeAttempt } from "../../payment/attempts.js";
import { operationRoute } from "../../request/cross-chain.js";
import {
  fundingRecoverArgs,
  fundingRecoverOptions,
  fundingRecoverOutput,
} from "../../schemas/funding.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { walletError } from "../../shared/errors.js";
import { networkFields, networks, resolveNetwork } from "../../shared/network.js";
import { nextStep } from "../../shared/next.js";
import { escapeInvisible } from "../../shared/utils.js";
import { operationStore } from "./records.js";

type RecoverContext = {
  args: z.output<typeof fundingRecoverArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof fundingRecoverOptions>;
};

export const recoverCommand = {
  description: "Check a cross-chain funding operation with its route, without sending anything",
  args: fundingRecoverArgs,
  options: fundingRecoverOptions,
  alias: globalAlias,
  output: fundingRecoverOutput,
  async run({ args, globals }: RecoverContext) {
    return recoverFunding(args.id, globals.network);
  },
};

// Forgets a settled attempt, so a later request funds anew.
export const recoverAnnotations = { ...nonDestructive, idempotentHint: true, openWorldHint: true };

const statuses = {
  pending: "pending",
  completed: "completed",
  refunded: "refunded",
  actionRequired: "action_required",
} as const;

/**
 * Reconciles funding operation `id` (Phase 4): asks its route how it stands, never quoting or
 * submitting again. A completed or refunded operation, or one that never started, is settled, and
 * its attempt is forgotten so the request can fund anew; a pending one names this command again.
 */
export async function recoverFunding(id: string, networkFlag: string | undefined) {
  const attempt = await loadAttempt(id);
  const operation = await operationStore().get(id);
  if (!attempt && !operation)
    throw walletError({
      code: "E_NOT_FOUND",
      message: `No funding operation ${escapeInvisible(id)} is saved; 'tempo wallet funding list' shows them.`,
    });
  const chainId = attempt?.tempoChainId ?? operation?.request.from.chainId;
  const network =
    networks.find((candidate) => candidate.chainId === chainId) ??
    (await resolveNetwork(networkFlag));
  const fields = { ...networkFields(network.chainId), id };
  if (!operation) {
    await removeAttempt(id);
    return { ...fields, status: "not_started" as const, reference: null };
  }
  const route = operationRoute(operation as CrossChainOperation, network);
  if (!route)
    throw walletError({
      code: "E_USAGE",
      message: `Funding operation ${escapeInvisible(id)} used a route that is unavailable on ${network.name}.`,
    });
  const reference = operation.reference ?? operation.quote.reference;
  const result = await Promise.resolve()
    .then(() =>
      route.status(operation as CrossChainOperation, {
        signal: AbortSignal.timeout(15_000),
      }),
    )
    .catch(() => {
      throw walletError({
        code: "E_NETWORK",
        message: `${route.name === "stargate" ? "LayerZero Scan" : "Relay"} did not report funding operation ${escapeInvisible(id)}; retry shortly.`,
        retryable: true,
      });
    });
  const status = statuses[result.status];
  if (status === "completed" || status === "refunded") await removeAttempt(id);
  return {
    ...fields,
    status,
    reference,
    ...(status === "pending"
      ? nextStep(
          "The funding is still in flight. Run the next command again shortly; retry the request only once it reports completed or refunded.",
          ["wallet", "funding", "recover", id],
          { network, pollIntervalSeconds: 5, until: "status != pending" },
        )
      : {}),
  };
}
