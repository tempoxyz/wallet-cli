/**
 * Acquires the payment token on another chain through a route, with durable operations.
 * @module
 */
import { crossChainFunder } from '../funders/cross-chain.js';
/**
 * Creates a funder that bridges from `from` to `to` through `routes`, recording each operation in
 * `operations` so a crash can be reconciled.
 */
export const create = crossChainFunder;
