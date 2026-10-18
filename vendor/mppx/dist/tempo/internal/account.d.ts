import type { Account, Address } from 'viem';
import type { Account as TempoAccount } from 'viem/tempo';
import * as RemoteFeePayer from './remote-fee-payer.js';
/** Returns whether a value is a viem account. */
export declare function is(value: unknown): value is Account;
/** Returns whether an account is a Tempo access-key account. */
export declare function isAccessKeyAccount(account: Account): account is Account & TempoAccount.AccessKeyAccount;
/** Returns the address that should authorize direct account signatures. */
export declare function getAccountSignerAddress(account: Account): Address;
/**
 * Resolves a recipient address and optional fee payer from flexible input parameters.
 *
 * Accepts either `account` or `recipient` as the parameter name. When the value
 * is an `Account`, its address is extracted. If `feePayer` is `true`, the
 * account also acts as the fee payer. Alternatively, a separate `Account`
 * can be provided as the fee payer, or remote fee-payer configuration (used
 * with `withFeePayer` transport wrapping).
 *
 * @returns Resolved account, local fee payer, remote fee payer, and recipient.
 */
export declare function resolve(parameters: resolve.Parameters): {
    account: Account | undefined;
    feePayer: Account | undefined;
    remoteFeePayer: Readonly<{
        fetch?: typeof globalThis.fetch | undefined;
        headers?: Readonly<Record<string, string>> | undefined;
        url: string;
    }> | undefined;
    recipient: Address | undefined;
};
export declare namespace resolve {
    type Parameters = {
        recipient?: Address | undefined;
        /** Account or address that performs payment operations / receives payment. */
        account?: Account | Address | undefined;
        /**
         * When `true`, the account also sponsors fees. An `Account` or remote fee-payer
         * configuration can also be provided. A string is shorthand for its URL.
         */
        feePayer?: Account | RemoteFeePayer.Config | string | true | undefined;
    };
}
//# sourceMappingURL=account.d.ts.map