/**
 * The swap integration an `EvmFunder` quotes and executes.
 * @module
 */
import { evmRoute } from '../funders/evm.js';
/** Validates a route and returns a frozen copy, so later mutation cannot change trusted behavior. */
export const from = evmRoute;
