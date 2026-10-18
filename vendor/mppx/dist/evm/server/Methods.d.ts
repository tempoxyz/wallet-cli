import type { NoExtraKeys } from '../../internal/types.js';
import * as Assets from '../Assets.js';
import * as Chains from '../Chains.js';
import { charge as charge_ } from './Charge.js';
/**
 * Creates ordered EVM charge offers from shared parameters.
 *
 * Pass `currencies: [token]` for one asset or an ordered list for multiple assets.
 * Viem token definitions resolve against `chainId`; known assets carry their own
 * network. Unsupported chain entries are skipped and duplicate chain/address
 * pairs are removed. An empty resolved list throws.
 *
 * Token definitions need explicit EIP-3009 domain metadata. Use
 * `evm.assets.fromToken(token, { chainId, transfer })` for per-token domains.
 * A token registry entry alone does not establish EIP-3009 support.
 *
 * @example
 * ```ts
 * import { evm } from 'mppx/server'
 *
 * evm({
 *   currencies: [evm.assets.base.USDC],
 *   recipient: '0x742d35Cc6634c0532925a3b844bC9e7595F8fE00',
 *   settle: async ({ payload }) => settleAuthorization(payload),
 * })
 * ```
 */
export declare function evm<const parameters extends evm.Parameters>(parameters: NoExtraKeys<parameters, evm.Parameters>): [import("../../Method.js").Server<{
    readonly name: "evm";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniObject<{
                from: import("zod/mini").ZodMiniString<string>;
                nonce: import("zod/mini").ZodMiniString<string>;
                signature: import("zod/mini").ZodMiniString<string>;
                to: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"authorization">;
                validAfter: import("zod/mini").ZodMiniString<string>;
                validBefore: import("zod/mini").ZodMiniString<string>;
                value: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniNumber<number>;
            currency: import("zod/mini").ZodMiniString<string>;
            credentialTypes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                authorization: "authorization";
            }>>>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            permit2Address: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniString<string>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                recipient: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
            description?: string | undefined;
            externalId?: string | undefined;
            amount: string;
            currency: `0x${string}`;
            methodDetails: {
                chainId: number;
                credentialTypes: string[];
                decimals: number;
                permit2Address?: `0x${string}` | undefined;
                splits?: {
                    amount: string;
                    recipient: string;
                }[] | undefined;
            };
            recipient: `0x${string}`;
        }, {
            amount: string;
            chainId: number;
            currency: string;
            credentialTypes?: "authorization"[] | undefined;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            permit2Address?: string | undefined;
            recipient: string;
            splits?: {
                amount: string;
                recipient: string;
            }[] | undefined;
        }>>;
    };
}, charge_.Defaults, import("../../server/Transport.js").Http, {}, string | undefined>, ...import("../../Method.js").Server<{
    readonly name: "evm";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniObject<{
                from: import("zod/mini").ZodMiniString<string>;
                nonce: import("zod/mini").ZodMiniString<string>;
                signature: import("zod/mini").ZodMiniString<string>;
                to: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"authorization">;
                validAfter: import("zod/mini").ZodMiniString<string>;
                validBefore: import("zod/mini").ZodMiniString<string>;
                value: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniNumber<number>;
            currency: import("zod/mini").ZodMiniString<string>;
            credentialTypes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                authorization: "authorization";
            }>>>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            permit2Address: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniString<string>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                recipient: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
            description?: string | undefined;
            externalId?: string | undefined;
            amount: string;
            currency: `0x${string}`;
            methodDetails: {
                chainId: number;
                credentialTypes: string[];
                decimals: number;
                permit2Address?: `0x${string}` | undefined;
                splits?: {
                    amount: string;
                    recipient: string;
                }[] | undefined;
            };
            recipient: `0x${string}`;
        }, {
            amount: string;
            chainId: number;
            currency: string;
            credentialTypes?: "authorization"[] | undefined;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            permit2Address?: string | undefined;
            recipient: string;
            splits?: {
                amount: string;
                recipient: string;
            }[] | undefined;
        }>>;
    };
}, charge_.Defaults, import("../../server/Transport.js").Http, {}, string | undefined>[]] | readonly [import("../../Method.js").Server<{
    readonly name: "evm";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniObject<{
                from: import("zod/mini").ZodMiniString<string>;
                nonce: import("zod/mini").ZodMiniString<string>;
                signature: import("zod/mini").ZodMiniString<string>;
                to: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"authorization">;
                validAfter: import("zod/mini").ZodMiniString<string>;
                validBefore: import("zod/mini").ZodMiniString<string>;
                value: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniNumber<number>;
            currency: import("zod/mini").ZodMiniString<string>;
            credentialTypes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                authorization: "authorization";
            }>>>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            permit2Address: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniString<string>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                recipient: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
            description?: string | undefined;
            externalId?: string | undefined;
            amount: string;
            currency: `0x${string}`;
            methodDetails: {
                chainId: number;
                credentialTypes: string[];
                decimals: number;
                permit2Address?: `0x${string}` | undefined;
                splits?: {
                    amount: string;
                    recipient: string;
                }[] | undefined;
            };
            recipient: `0x${string}`;
        }, {
            amount: string;
            chainId: number;
            currency: string;
            credentialTypes?: "authorization"[] | undefined;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            permit2Address?: string | undefined;
            recipient: string;
            splits?: {
                amount: string;
                recipient: string;
            }[] | undefined;
        }>>;
    };
}, charge_.Defaults, import("../../server/Transport.js").Http, {}, string | undefined>];
export declare namespace evm {
    /** Accepted EVM currency metadata, including chain-indexed definitions from `viem/tokens`. */
    type Currency = Assets.Currency;
    /** Shared EVM settlement parameters and ordered accepted currencies. */
    type Parameters = Omit<charge_.Parameters, 'currency'> & ({
        /** Ordered accepted currencies. A one-element list accepts a single asset. */
        currencies: readonly Currency[];
        currency?: undefined;
    } | {
        /** @deprecated Use `currencies: [currency]` instead. */
        currency: Currency;
        currencies?: undefined;
    });
    /** Creates an EVM `charge` server method. */
    const charge: typeof charge_;
    /** Known EVM asset metadata for public config. */
    const assets: typeof Assets;
    /** Common EVM chain IDs for public config. */
    const chains: typeof Chains;
}
//# sourceMappingURL=Methods.d.ts.map