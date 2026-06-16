import type { Address, Hex } from "viem";

export type SessionDescriptor = {
  authorizedSigner: Address;
  expiringNonceHash: Hex;
  operator: Address;
  payee: Address;
  payer: Address;
  salt: Hex;
  token: Address;
};

export type SessionDescriptorRecord = {
  descriptor_json?: string | undefined;
};

export function sessionDescriptorFromRecord(
  record: SessionDescriptorRecord,
): SessionDescriptor | undefined {
  if (!record.descriptor_json) return undefined;
  return JSON.parse(record.descriptor_json) as SessionDescriptor;
}

export function requireSessionDescriptor(record: SessionDescriptorRecord): SessionDescriptor {
  const descriptor = sessionDescriptorFromRecord(record);
  if (!descriptor) throw new Error("v2 session management requires a stored channel descriptor");
  return descriptor;
}
