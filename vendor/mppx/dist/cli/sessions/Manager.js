import * as Challenge from '../../Challenge.js';
import { resolveEscrow } from '../../tempo/session/client/ChannelOps.js';
import { getSessionManagerInternals } from '../../tempo/session/client/internal/SessionManager.js';
import { sessionManager } from '../../tempo/session/client/SessionManager.js';
import { getSessionSnapshot, isTempoSessionChallenge, } from '../../tempo/session/client/Transports.js';
function resolveFetch(fetch) {
    return fetch ?? globalThis.fetch.bind(globalThis);
}
function assertCloseChallengeScope(challenge, channel) {
    const chainId = challenge.request.methodDetails?.chainId;
    if (chainId !== undefined && chainId !== channel.chainId)
        throw new Error('Close challenge changed the session chain.');
    if (typeof challenge.request.recipient !== 'string' ||
        challenge.request.recipient.toLowerCase() !== channel.descriptor.payee.toLowerCase())
        throw new Error('Close challenge changed the session payee.');
    if (typeof challenge.request.currency !== 'string' ||
        challenge.request.currency.toLowerCase() !== channel.descriptor.token.toLowerCase())
        throw new Error('Close challenge changed the session token.');
    if (resolveEscrow(challenge, channel.escrow).toLowerCase() !== channel.escrow.toLowerCase())
        throw new Error('Close challenge changed the session escrow.');
    const snapshot = getSessionSnapshot(challenge);
    if (snapshot && snapshot.channelId.toLowerCase() !== channel.channelId.toLowerCase())
        throw new Error('Close challenge changed the session channel.');
}
/** Rehydrates durable session context and cooperatively closes it through the manager. */
export async function closeWithSessionManager(parameters) {
    assertCloseChallengeScope(parameters.challenge, parameters.channel);
    const networkFetch = resolveFetch(parameters.fetch);
    let pendingChallenge;
    const validatedFetch = async (input, init) => {
        if (pendingChallenge) {
            await parameters.onChallenge?.(pendingChallenge);
            pendingChallenge = undefined;
        }
        const response = await networkFetch(input, init);
        if (response.status !== 402)
            return response;
        const refreshed = Challenge.fromResponseList(response).find(isTempoSessionChallenge);
        if (!refreshed)
            throw new Error('Refreshed close response did not include tempo/session.');
        assertCloseChallengeScope(refreshed, parameters.channel);
        pendingChallenge = refreshed;
        return response;
    };
    const manager = sessionManager({
        ...parameters.manager,
        bootstrap: false,
        escrow: parameters.channel.escrow,
        fetch: validatedFetch,
    });
    getSessionManagerInternals(manager).rehydrate(parameters);
    const receipt = await manager.close();
    if (!receipt)
        throw new Error('Session close response did not include a payment receipt.');
    return { manager, receipt };
}
//# sourceMappingURL=Manager.js.map