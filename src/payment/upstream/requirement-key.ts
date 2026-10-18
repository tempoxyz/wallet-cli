/**
 * [MF-14] `requirementKey(requirement)`: machine-fetch's identity for "the same payment", which it
 * keeps internal (`requirementKeyOf` in src/funders/cross-chain.ts). The CLI persists attempt IDs
 * between runs and must reuse one only for the payment machine-fetch would also call the same, so
 * this copies its encoding exactly. Delete once machine-fetch exports it.
 */
import type { PaymentRequirement } from "machine-fetch/interfaces";

/** Encodes payment terms unambiguously; network and resource values themselves contain colons. */
export function requirementKey(requirement: PaymentRequirement): string {
  const { network } = requirement;
  return JSON.stringify([
    requirement.protocol,
    requirement.method,
    requirement.intent,
    network,
    canonicalIdentifier(network, requirement.asset),
    requirement.amount.toString(),
    canonicalIdentifier(network, requirement.recipient) ?? null,
    requirement.resource ?? null,
  ]);
}

function canonicalIdentifier(network: string, identifier: string | undefined) {
  return identifier !== undefined &&
    /^eip155:[1-9]\d*$/.test(network) &&
    /^0x[\da-fA-F]{40}$/.test(identifier)
    ? identifier.toLowerCase()
    : identifier;
}
