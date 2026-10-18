import { Hex } from 'ox';
import { KeyAuthorization } from 'ox/tempo';
import { isAddressEqual } from 'viem';
import { tempo as tempo_chain } from 'viem/tempo/chains';
import * as Credential from '../../Credential.js';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as defaults from '../internal/defaults.js';
import * as Methods from '../Methods.js';
import { getSubscriptionChallengeWitness, getSubscriptionScopes, signSubscriptionKeyAuthorization, toSubscriptionExpiryDate, toSubscriptionExpirySeconds, toSubscriptionPeriodSeconds, verifySubscriptionKeyAuthorization, } from '../subscription/KeyAuthorization.js';
/** Context accepted by the Tempo subscription client method. */
export const subscriptionContextSchema = z.object({
    accessKey: z.optional(z.custom()),
    account: z.optional(z.custom()),
});
/** Creates a Tempo subscription client method. */
export function subscription(parameters = {}) {
    const getClient = Client.getResolver({
        chain: tempo_chain,
        getClient: parameters.getClient,
        rpcUrl: defaults.rpcUrl,
    });
    const getAccount = Account.getResolver({ account: parameters.account });
    return Method.toClient(Methods.subscription, {
        context: subscriptionContextSchema,
        async createCredential({ challenge, context }) {
            const chainId = challenge.request.methodDetails?.chainId ?? defaults.chainId.testnet;
            const client = await getClient({ chainId });
            const account = getAccount(client, context);
            const accessKey = context?.accessKey ?? parameters.accessKey ?? challenge.request.methodDetails?.accessKey;
            if (!accessKey) {
                throw new Error('No `accessKey` provided. The subscription challenge must include `accessKey`, or the client must pass one to parameters/context.');
            }
            assertSubscriptionRequestRepresentable(challenge.request);
            await parameters.validateRequest?.(challenge.request);
            const keyAuthorization = await authorizeAccessKey(client, {
                accessKey,
                account,
                challengeId: challenge.id,
                chainId,
                request: challenge.request,
            });
            const verified = verifySubscriptionKeyAuthorization({
                accessKey,
                challengeId: challenge.id,
                chainId,
                payload: {
                    signature: KeyAuthorization.serialize(keyAuthorization),
                    type: 'keyAuthorization',
                },
                request: challenge.request,
            });
            if (!isAddressEqual(verified.source.address, account.address)) {
                throw new Error('keyAuthorization signer does not match the selected account');
            }
            return Credential.serialize({
                challenge,
                payload: {
                    signature: KeyAuthorization.serialize(keyAuthorization),
                    type: 'keyAuthorization',
                },
                source: `did:pkh:eip155:${chainId}:${account.address.toLowerCase()}`,
            });
        },
    });
}
async function authorizeAccessKey(client, parameters) {
    const { accessKey, account, challengeId, chainId, request } = parameters;
    const local = await signSubscriptionKeyAuthorization({
        accessKey,
        account,
        challengeId,
        chainId,
        request,
    });
    if (local)
        return local;
    const result = (await client.request({
        method: 'wallet_authorizeAccessKey',
        params: [
            {
                address: accessKey.accessKeyAddress,
                expiry: toSubscriptionExpirySeconds(toSubscriptionExpiryDate(request.subscriptionExpires)),
                keyType: accessKey.keyType,
                limits: [
                    {
                        token: request.currency,
                        limit: Hex.fromNumber(BigInt(request.amount)),
                        period: toSubscriptionPeriodSeconds(request),
                    },
                ],
                scopes: getSubscriptionScopes(request),
                witness: getSubscriptionChallengeWitness(challengeId),
            },
        ],
    }));
    return KeyAuthorization.fromRpc(result.keyAuthorization);
}
function assertSubscriptionRequestRepresentable(request) {
    toSubscriptionPeriodSeconds(request);
    toSubscriptionExpirySeconds(toSubscriptionExpiryDate(request.subscriptionExpires));
}
//# sourceMappingURL=Subscription.js.map