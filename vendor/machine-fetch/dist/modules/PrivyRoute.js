import { privyCrossChainRoute, privyEvmRoute } from '../routes/privy.js';
/** Creates a same-chain swap route for `EvmFunder.create` through Privy wallet actions. */
export const evm = privyEvmRoute;
/** Creates a cross-chain route for `CrossChainFunder.create` through Privy wallet actions. */
export const crossChain = privyCrossChainRoute;
