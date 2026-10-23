import { Funder } from "machine-fetch";
import type { Hex } from "viem";

/** The 32-byte hex transaction hashes in `value`, ignoring anything else. */
export function transactionHashes(value: unknown): Hex[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (hash): hash is Hex => typeof hash === "string" && /^0x[\da-fA-F]{64}$/.test(hash),
  );
}

/**
 * `fetcher`, with a request that never reached `service` (DNS, refused connection, TLS) failing
 * as a FundingError that names it, so a route's refusal says which provider was down rather than
 * only "fetch failed". An aborted request is rethrown as is.
 */
export function namedFetch(
  service: string,
  fetcher: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      return await fetcher(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const reasons: string[] = [];
      for (
        let cause: unknown = error;
        cause instanceof Error && reasons.length < 3;
        cause = cause.cause
      )
        reasons.push(cause.message);
      throw new Funder.FundingError(`${service} is unreachable (${reasons.join(": ")})`);
    }
  }) as typeof globalThis.fetch;
}
