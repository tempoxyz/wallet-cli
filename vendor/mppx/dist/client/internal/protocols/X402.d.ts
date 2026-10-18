import type { Protocol } from './Protocol.js';
/**
 * x402 — a 402 carrying a `PAYMENT-REQUIRED` header, paid back in `PAYMENT-SIGNATURE`. Synthesized
 * challenges are branded for `evm/client/Charge.ts`, keeping them distinct from native `evm`
 * charges with the same method/intent.
 */
export declare function x402(): Protocol;
//# sourceMappingURL=X402.d.ts.map