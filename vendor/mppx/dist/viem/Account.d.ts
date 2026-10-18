import type { Address, Client, Account as viem_Account } from 'viem';
export type Account = viem_Account;
export declare function getResolver(parameters?: getResolver.Parameters): (client: Client, { account: override }?: {
    account?: Account | Address | undefined;
}) => Account;
export declare namespace getResolver {
    type Parameters = {
        /** Account to use for signing. If an Address is provided, it must match the client's account. */
        account?: Account | Address | undefined;
    };
}
//# sourceMappingURL=Account.d.ts.map