/**
 * [MF-23] A route's status with the destination transactions that delivered a completed
 * operation, when the provider names them. machine-fetch's `CrossChainStatus` has no field for
 * them, and the destination balance alone cannot confirm a delivery a payment already spent.
 */
import type { CrossChain } from "machine-fetch/cross-chain";
import type { Hex } from "viem";

export type DeliveredStatus = CrossChain.Status & {
  /** Destination-chain transactions the provider reports delivering the operation. */
  destinationTxs?: readonly Hex[] | undefined;
};

/** The 32-byte hex transaction hashes in `value`, ignoring anything else. */
export function transactionHashes(value: unknown): Hex[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (hash): hash is Hex => typeof hash === "string" && /^0x[\da-fA-F]{64}$/.test(hash),
  );
}
