import type * as Credential from '../../Credential.js';
import * as Method from '../../Method.js';
import * as ServerTransport from '../../server/Transport.js';
import * as X402 from '../../x402/server/EvmCharge.js';
import * as Assets from '../Assets.js';
import * as Methods from '../Methods.js';
import * as Types from '../Types.js';
/**
 * Creates an EVM charge server method.
 *
 * Speaks the native Payment-auth `evm/charge` wire format.
 * Supports non-mutating `validateCredential` checks before settlement through
 * `broadcastCredential`. Validation checks the signature and payment terms, and
 * checks the facilitator when using facilitator-backed settlement. Custom
 * settlers remain responsible for chain-state checks and replay protection.
 */
export declare function charge(parameters: charge.NativeConfig): Method.Server<typeof Methods.charge, charge.Defaults, ServerTransport.Http>;
export declare namespace charge {
    type Parameters = NativeConfig;
    type Native = Method.Server<typeof Methods.charge, Defaults, ServerTransport.Http>;
    type NativeConfig = BaseConfig & CurrencyConfig & RecipientConfig & Method.ComposableHooks<typeof Methods.charge>;
    type BaseConfig = {
        /** EIP-3009 token domain metadata. Required for raw addresses and viem tokens; inferred for known assets. */
        authorization?: Types.AuthorizationConfig | undefined;
        /** EVM chain ID. Required for raw addresses and viem tokens; inferred for known assets. */
        chainId?: number | undefined;
        /** Token decimal places. Required for raw addresses; inferred for known assets and viem tokens. */
        decimals?: number | undefined;
        /** Custom settlement override. If omitted, `x402.facilitator` is used. */
        settle?: SettleAuthorization | undefined;
        /** x402 compatibility options. */
        x402?: X402.Options | undefined;
    };
    type CurrencyConfig = {
        /** Token contract address, known EVM asset metadata, or viem token definition. */
        currency: Assets.Currency;
    };
    type RecipientConfig = {
        /** Recipient wallet address. */
        recipient: `0x${string}`;
    };
    type RouteOptions = {
        /** Required display-unit token amount. */
        amount: string;
        /** Optional human-readable payment description. */
        description?: string | undefined;
        /** Optional external correlation ID. */
        externalId?: string | undefined;
    };
    type SettleAuthorization = (parameters: {
        credential: Credential.Credential<Types.AuthorizationPayload>;
        payload: Types.AuthorizationPayload;
        request: Types.ChargeRequest;
        source: ReturnType<typeof Types.toSource>;
    }) => Promise<{
        reference: string;
        timestamp?: string | undefined;
    }>;
    type Defaults = {
        chainId: number;
        currency: `0x${string}`;
        credentialTypes: ['authorization'];
        decimals: number;
        recipient: `0x${string}`;
    };
}
//# sourceMappingURL=Charge.d.ts.map