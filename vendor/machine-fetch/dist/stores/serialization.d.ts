import type { CrossChainOperation, CrossChainOperationStore } from '../interfaces/cross-chain.js';
/**
 * Marks a released generation where one slot holds either a reference or a release. Provider
 * references never contain NUL, and {@link checkReference} rejects any that do.
 */
export declare const releasedReference = "\0released";
/** Versioned JSON with escaped string tags so provider data cannot collide with bigint values. */
export declare function serialize(operation: CrossChainOperation): string;
/** Corrupt, incompatible, or incomplete records fail closed instead of appearing absent. */
export declare function deserialize(serialized: string, id: string): CrossChainOperation;
/** References are immutable once attached, including when writes race or are retried. */
export declare function checkReference(operation: CrossChainOperation | undefined, reference: string): asserts operation is CrossChainOperation;
/** Only an operation without a submission reference may be released. */
export declare function checkRelease(operation: CrossChainOperation | undefined): asserts operation is CrossChainOperation;
/** Reports every backend failure, such as I/O or quota errors, as OperationStoreError. */
export declare function guardStore(store: Required<CrossChainOperationStore>): CrossChainOperationStore;
//# sourceMappingURL=serialization.d.ts.map