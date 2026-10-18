import type { HTTPRequestContext, x402ResourceServer } from '@x402/core/server';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
/** Configuration shared by the x402 compatibility integrations. */
export type Config = {
    /** Realm used in MPP challenges. Defaults using the normal mppx realm resolution. */
    realm?: string | undefined;
    /** Secret used to bind MPP challenge IDs to their contents. Must contain at least 32 bytes. */
    secretKey: string;
    /** Existing x402 resource server used for requirement metadata, verification, and settlement. */
    server: x402ResourceServer;
};
/** Creates a native MPP handler backed by a compatible x402 EVM requirement. */
export declare function createHandler(parameters: {
    config: Config;
    context: HTTPRequestContext;
    paymentRequired: PaymentRequired;
}): ((request: Request) => Promise<{
    payment: {
        challenge: Response;
        status: 402;
    } | {
        status: 200;
        withReceipt: import("../../server/Transport.js").WithReceipt<import("../../server/Transport.js").Http>;
    };
    skipHandlerResponse: Response | undefined;
}>) | undefined;
/** Selects an extension-free EIP-3009 requirement that can be represented without semantic loss. */
export declare function selectRequirement(paymentRequired: PaymentRequired, server: x402ResourceServer): PaymentRequirements | undefined;
//# sourceMappingURL=Evm.d.ts.map