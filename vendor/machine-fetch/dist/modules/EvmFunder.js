/**
 * Swaps ERC-20 tokens into the payment token through caller-trusted routes before paying.
 * @module
 */
import { evmFunder } from '../funders/evm.js';
/** Creates a funder that acquires the payment token on the same EVM chain through `routes`. */
export const create = evmFunder;
