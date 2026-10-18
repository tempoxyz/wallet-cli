import { isAddress } from 'viem';
import * as HeaderCodec from '../../internal/HeaderCodec.js';
import * as z from '../../zod.js';
const addressSchema = z.custom((value) => typeof value === 'string' && isAddress(value, { strict: false }));
const hashSchema = z.custom((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value));
const hexSchema = z.custom((value) => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value));
const channelDescriptorSchema = z.object({
    authorizedSigner: addressSchema,
    expiringNonceHash: hashSchema,
    operator: addressSchema,
    payee: addressSchema,
    payer: addressSchema,
    salt: hashSchema,
    token: addressSchema,
});
const sessionSnapshotSchema = z.object({
    acceptedCumulative: z.string(),
    chainId: z.number(),
    channelId: hashSchema,
    closeRequestedAt: z.optional(z.string()),
    deposit: z.string(),
    descriptor: channelDescriptorSchema,
    escrow: addressSchema,
    highestVoucher: z.optional(z.object({
        channelId: hashSchema,
        cumulativeAmount: z.string(),
        signature: hexSchema,
    })),
    requiredCumulative: z.string(),
    settled: z.string(),
    spent: z.string(),
    units: z.optional(z.number()),
});
const sessionSnapshotHeader = HeaderCodec.createJson(sessionSnapshotSchema);
/** Serializes a session snapshot for the `Payment-Session-Snapshot` header. */
export function serializeSnapshot(snapshot) {
    return sessionSnapshotHeader.encode(snapshot);
}
/** Deserializes a session snapshot from the `Payment-Session-Snapshot` header. */
export function deserializeSnapshot(value) {
    return sessionSnapshotHeader.decode(value);
}
//# sourceMappingURL=Snapshot.js.map