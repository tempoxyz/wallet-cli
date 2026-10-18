import type * as Types from './Types.js';
/** Verifies every configured request-attestation protocol. */
export declare function verify<const verifiers extends Types.VerifierMap>(request: Request, verifiers: verifiers): Promise<Types.VerificationsFrom<verifiers>>;
//# sourceMappingURL=Server.d.ts.map