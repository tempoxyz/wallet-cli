import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Challenge from '../Challenge.js';
import * as AcceptPayment from '../internal/AcceptPayment.js';
import { evm as evmPlugin, stripe as stripePlugin, tempo as tempoPlugin, x402 as x402Plugin, } from './plugins/index.js';
const builtinPlugins = [tempoPlugin(), stripePlugin(), evmPlugin(), x402Plugin()];
/** Runs configured payment extensions in order and threads credential context between them. */
export async function preparePayment(challenge, extensions, credentialContext) {
    let current = credentialContext;
    for (const extension of extensions ?? []) {
        const result = await extension.preparePayment?.({
            challenge,
            ...(current !== undefined ? { credentialContext: current } : {}),
        });
        if (result && 'credentialContext' in result)
            current = result.credentialContext;
    }
    return current;
}
/** Resolves explicit payment configuration before falling back to built-in plugins. */
export function resolvePlugin(challenge, config) {
    const configPlugin = config?.plugins?.find((p) => supportsPlugin(p, challenge));
    if (configPlugin)
        return { plugin: configPlugin };
    const configMethods = flattenConfigMethods(config);
    const matching = configMethods?.filter((m) => m.name === challenge.method && m.intent === challenge.intent);
    const matched = matching?.find((m) => m.canHandleChallenge?.({ challenge }) ?? true);
    if (matched)
        return { method: matched };
    if (matching?.length)
        return {};
    const builtin = builtinPlugins.find((p) => supportsPlugin(p, challenge));
    if (builtin)
        return { plugin: builtin };
    return {};
}
export function selectChallenge(challenges, config) {
    const configMethods = flattenConfigMethods(config);
    if (configMethods?.length) {
        const resolvedPreferences = AcceptPayment.resolve(configMethods, config?.paymentPreferences);
        const selected = AcceptPayment.selectChallenge(challenges, configMethods, resolvedPreferences.entries);
        if (selected) {
            const plugin = config?.plugins?.find((plugin) => supportsPlugin(plugin, selected.challenge));
            return {
                challenge: selected.challenge,
                ...(plugin ? { plugin } : { method: selected.method }),
            };
        }
        return undefined;
    }
    for (const challenge of challenges) {
        const resolved = resolvePlugin(challenge, config);
        if (resolved.plugin || resolved.method)
            return { challenge, ...resolved };
    }
    return undefined;
}
export function resolveAcceptPayment(config) {
    const methods = flattenConfigMethods(config);
    if (!methods?.length)
        return undefined;
    return AcceptPayment.resolve(methods, config?.paymentPreferences).header;
}
export function flattenConfigMethods(config) {
    return Array.isArray(config?.methods) ? config.methods.flat() : undefined;
}
function supportsPlugin(plugin, challenge) {
    return plugin.supports ? plugin.supports(challenge) : plugin.method === challenge.method;
}
/** Loads CLI config only from explicit, user-selected paths. */
export async function loadConfig(configFile) {
    const configPath = resolveConfigPath(configFile);
    if (!configPath)
        return undefined;
    const mod = await import(configPath);
    return { config: (mod.default ?? mod), path: configPath };
}
function resolveConfigPath(configFile) {
    // 0. Explicit --config flag
    if (configFile) {
        const resolved = path.resolve(configFile);
        if (fs.existsSync(resolved))
            return resolved;
        return undefined;
    }
    // 1. Explicit env var
    const envPath = process.env.MPPX_CONFIG?.trim();
    if (envPath) {
        const resolved = path.resolve(envPath);
        if (fs.existsSync(resolved))
            return resolved;
        return undefined;
    }
    return undefined;
}
/** Rejects retry challenges that change the payment the caller approved. */
export function assertSamePaymentRequest(approved, retry) {
    function paymentTerms(challenge) {
        const request = { ...challenge.request };
        if (challenge.method === 'tempo' && challenge.intent === 'session') {
            const methodDetails = { ...request.methodDetails };
            // Snapshots advance session state; the session method validates them against
            // the unchanged payment terms before authorizing the next credential.
            delete methodDetails.sessionSnapshot;
            if (Object.keys(methodDetails).length)
                request.methodDetails = methodDetails;
            else
                delete request.methodDetails;
        }
        return Challenge.serialize({
            ...challenge,
            request,
            id: approved.id,
            expires: approved.expires,
        });
    }
    if (paymentTerms(retry) !== paymentTerms(approved))
        throw new Error('Payment request changed on retry. Run the command again to approve the new payment.');
}
//# sourceMappingURL=internal.js.map