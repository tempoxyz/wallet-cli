import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
/**
 * Creates a persistent store in a private directory on a local POSIX filesystem supporting hard links.
 *
 * Each ID holds numbered generations of immutable files. A generation's single reference file holds
 * either its submission reference or a release marker, so publishing one excludes the other.
 * Releasing lets the next claim create a new generation; nothing is ever deleted, so no write can
 * race a removal. Generation 0 uses the original `<hash>.json` and `<hash>.reference` names, so
 * stores written by, and workers running, earlier versions contend for the same claims.
 */
export declare function fileStore(directory: string): CrossChainOperationStore;
