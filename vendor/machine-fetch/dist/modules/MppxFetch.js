import { fromMppx, mppxExtension, mppxRequirement, } from '../adapters/mppx.js';
/**
 * Adapts an existing Mppx client into a payment client for `MachineFetch.from`, reusing its
 * methods, transport, and raw fetch. Mppx does not expose its other create-time settings, so supply
 * them again in `options`. The client supplies Tempo auto-swap as its own funder; see `autoSwap`.
 */
export const client = fromMppx;
/**
 * Creates an Mppx CLI extension backed by machine-fetch policy and funders. Each payment uses the
 * host's operation ID, or a random one, and the host's signal, when it supplies one.
 */
export const extension = mppxExtension;
/** Normalizes an Mppx challenge into the payment requirement policy and funders evaluate. */
export const requirement = mppxRequirement;
