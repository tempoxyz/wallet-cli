/**
 * An in-memory operation store for tests and short-lived processes; records do not survive a
 * restart.
 * @module
 */
import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
/** Creates an empty in-memory operation store. */
export declare const create: () => CrossChainOperationStore;
