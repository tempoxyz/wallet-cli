import type { CrossChainOperation } from "machine-fetch/interfaces/evm";
import { fileStore } from "machine-fetch/stores/file";
import { formatUnits } from "viem";

import { type AttemptRecord, listAttempts, operationsDirectory } from "../../payment/attempts.js";
import { formatUnixTimestamp } from "../../shared/utils.js";

/** The operation store funding writes, read without creating anything else. */
export function operationStore() {
  return fileStore(operationsDirectory());
}

/** A saved attempt with its operation, as `funding list` reports it. */
export function fundingItem(attempt: AttemptRecord, operation: CrossChainOperation | undefined) {
  const quote = operation?.quote as { maxAmountIn?: unknown } | undefined;
  return {
    id: attempt.attemptId,
    url: attempt.url,
    destination: attempt.destination.name,
    payer: attempt.payer.toLowerCase(),
    source: attempt.source.toLowerCase(),
    created_at: formatUnixTimestamp(attempt.createdAt) ?? "",
    status: !operation
      ? ("not_started" as const)
      : operation.reference
        ? ("submitted" as const)
        : ("claimed" as const),
    route: operation?.route ?? null,
    reference: operation?.reference ?? operation?.quote.reference ?? null,
    amount_out: operation ? formatUnits(operation.request.amountOut, 6) : null,
    max_amount_in:
      typeof quote?.maxAmountIn === "bigint" ? formatUnits(quote.maxAmountIn, 6) : null,
  };
}

export async function fundingAttempts(chainId: number) {
  return (await listAttempts()).filter((attempt) => attempt.tempoChainId === chainId);
}
