import { decodeFunctionData, encodeFunctionData, isAddress, isAddressEqual, parseAbi, } from 'viem';
import { call, readContract } from 'viem/actions';
import { Abis, Actions } from 'viem/tempo';
import * as defaults from './defaults.js';
const machineTokenSwapperAbi = parseAbi([
    'function swapTo(address inputToken,uint256 amount,address targetToken,address recipient,bytes32 memo)',
]);
function getDeployment(chainId) {
    if (chainId === undefined)
        return undefined;
    return defaults.machineToken[chainId];
}
/** Returns whether a first-party machine-token charge route is deployed on a chain. */
export function isSupported(chainId) {
    return !!getDeployment(chainId);
}
/** Returns whether a currency is the machine token for a supported chain. */
export function isMachineToken(parameters) {
    const deployment = getDeployment(parameters.chainId);
    return (!!deployment &&
        isAddress(parameters.currency, { strict: false }) &&
        isAddressEqual(parameters.currency, deployment.token));
}
/** Resolves the canonical first-party settlement route for a compatible charge. */
export function getRoute(parameters) {
    const deployment = getDeployment(parameters.chainId);
    const transfer = parameters.transfers.length === 1 ? parameters.transfers[0] : undefined;
    if (!deployment || !transfer?.memo)
        return undefined;
    const amount = BigInt(transfer.amount);
    const memo = transfer.memo;
    return {
        calls: [
            {
                data: encodeFunctionData({
                    abi: Abis.tip20,
                    functionName: 'approve',
                    args: [deployment.swap, amount],
                }),
                to: deployment.token,
            },
            {
                data: encodeFunctionData({
                    abi: machineTokenSwapperAbi,
                    functionName: 'swapTo',
                    args: [deployment.token, amount, parameters.currency, transfer.recipient, memo],
                }),
                to: deployment.swap,
            },
        ],
        settlementSender: deployment.swap,
        transfers: [{ amount, memo, recipient: transfer.recipient }],
    };
}
/** Builds and simulates the first-party settlement route. */
export async function findRoute(client, parameters) {
    const route = getRoute(parameters);
    if (!route)
        return undefined;
    try {
        const balance = await readContract(client, Actions.token.getBalance.call(client, {
            account: parameters.account,
            token: route.calls[0].to,
        }));
        if (balance < route.transfers[0].amount)
            return undefined;
        await call(client, { account: parameters.account, calls: route.calls });
        return route;
    }
    catch {
        return undefined;
    }
}
/** Matches an exact first-party settlement route. */
export function matchRoute(parameters) {
    const transfer = parameters.transfers.length === 1 ? parameters.transfers[0] : undefined;
    const swap = parameters.calls[1];
    if (!transfer || parameters.calls.length !== 2 || !swap?.data)
        return undefined;
    try {
        const decoded = decodeFunctionData({ abi: machineTokenSwapperAbi, data: swap.data });
        const route = getRoute({
            ...parameters,
            transfers: [{ ...transfer, memo: transfer.memo ?? decoded.args[4] }],
        });
        if (!route)
            return undefined;
        if (parameters.calls.some((call, index) => {
            const expected = route.calls[index];
            return (!call.data ||
                !call.to ||
                !expected ||
                (call.value ?? 0n) !== 0n ||
                !isAddressEqual(call.to, expected.to) ||
                call.data.toLowerCase() !== expected.data.toLowerCase());
        }))
            return undefined;
        return route;
    }
    catch {
        return undefined;
    }
}
/** Returns the trusted sender that settles the configured charge route on a chain. */
export function getSettlementSender(chainId) {
    return getDeployment(chainId)?.swap;
}
//# sourceMappingURL=machine-token-charge.js.map