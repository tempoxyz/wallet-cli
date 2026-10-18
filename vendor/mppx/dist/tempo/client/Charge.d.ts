import type { Address } from 'viem';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as AutoSwap from '../internal/auto-swap.js';
import * as Methods from '../Methods.js';
import type * as AccountResolution from './ResolveAccount.js';
/** Runtime context accepted by the Tempo charge client method. */
export type ChargeContext = {
    account?: Account.getResolver.Parameters['account'] | undefined;
    autoSwap?: AutoSwap.resolve.Value | undefined;
    mode?: Methods.ChargeMode | undefined;
};
/**
 * Creates a Tempo charge method intent for usage on the client.
 *
 * @example
 * ```ts
 * import { tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const charge = tempo.charge({
 *   account: privateKeyToAccount('0x...'),
 * })
 * ```
 */
export declare function charge(parameters?: charge.Parameters): Method.Client<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                hash: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"hash">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"proof">;
            }, z.core.$strip>], "type">;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
            machineTokenEnabled: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>;
            amount: z.ZodMiniString<string>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<import("viem").Account, import("viem").Account>]>, z.ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: z.ZodMiniOptional<z.ZodMiniNever>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                amount: z.ZodMiniString<string>;
                memo: z.ZodMiniOptional<z.ZodMiniString<string>>;
                recipient: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
            }, z.core.$strip>>>;
            supportedModes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            currency: string;
            description?: string | undefined;
            externalId?: string | undefined;
            recipient?: string | undefined;
            amount: string;
            methodDetails?: {
                machineTokenEnabled?: boolean | undefined;
                chainId?: number | undefined;
                feePayer?: boolean | undefined;
                splits?: {
                    memo?: string | undefined;
                    recipient: `0x${string}`;
                    amount: string;
                }[] | undefined;
                supportedModes?: ("pull" | "push")[] | undefined;
            } | undefined;
        }, {
            machineTokenEnabled?: boolean | undefined;
            amount: string;
            chainId?: number | undefined;
            currency: string;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            feePayer?: boolean | undefined;
            memo?: undefined;
            recipient?: string | undefined;
            splits?: {
                amount: string;
                memo?: string | undefined;
                recipient: `0x${string}`;
            }[] | undefined;
            supportedModes?: ("pull" | "push")[] | undefined;
        }>>;
    };
}, z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    autoSwap: z.ZodMiniOptional<z.ZodMiniCustom<AutoSwap.resolve.Value | undefined, AutoSwap.resolve.Value | undefined>>;
    mode: z.ZodMiniOptional<z.ZodMiniEnum<{
        pull: "pull";
        push: "push";
    }>>;
}, z.core.$strip>>;
export declare namespace charge {
    type AutoSwap = AutoSwap.resolve.Value;
    type Context = ChargeContext;
    type ResolveAccount = AccountResolution.ResolveAccount;
    type ResolveAccountInfo = AccountResolution.ResolveAccountInfo;
    type Parameters = {
        /**
         * Automatically swap from a fallback currency (pathUsd, USDC.e) via the
         * Tempo DEX when the user lacks sufficient balance of the target currency.
         *
         * @default false
         */
        autoSwap?: AutoSwap | undefined;
        /** Client identifier used to derive the client fingerprint in attribution memos. */
        clientId?: string | undefined;
        /**
         * Chain ID this client is willing to pay on. When set, the client rejects
         * any challenge whose `methodDetails.chainId` differs, and signs on this
         * chain when the challenge omits a chain ID.
         */
        expectedChainId?: number | undefined;
        /**
         * Chains permitted for payment credentials. Omitted allows any chain; empty rejects all.
         * A single entry supplies an omitted challenge chain unless `expectedChainId` is set.
         * When both policies are set, the selected chain must satisfy both.
         */
        allowedChainIds?: readonly number[] | undefined;
        /**
         * Allowlist of payment recipient addresses. When set, both the primary
         * recipient and every split recipient must be included in this list.
         */
        expectedRecipients?: readonly Address[] | undefined;
        /**
         * Controls how the charge transaction is submitted.
         *
         * - `'push'`: Client broadcasts the transaction and sends the tx hash to the server.
         * - `'pull'`: Client signs the transaction and sends the serialized tx to the server for broadcast.
         *
         * If the server advertises `supportedModes`, this setting must be one of
         * the supported values for the challenge.
         *
         * @default `'push'` for JSON-RPC accounts, `'pull'` for local accounts.
         */
        mode?: Methods.ChargeMode | undefined;
        /** Selects the account that signs this charge after the challenge and chain are known. */
        resolveAccount?: ResolveAccount | undefined;
    } & Account.getResolver.Parameters & Client.getResolver.Parameters;
}
//# sourceMappingURL=Charge.d.ts.map