import { parseAccount } from 'viem/accounts';
export function getResolver(parameters = {}) {
    const { account: defaultAccount } = parameters;
    return (client, { account: override } = {}) => {
        const account = override ?? defaultAccount;
        if (!account) {
            if (!client.account)
                throw new Error('No `account` provided. Pass `account` to parameters or context.');
            return client.account;
        }
        return parseAccount(account);
    };
}
//# sourceMappingURL=Account.js.map