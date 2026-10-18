import * as Challenge from '../Challenge.js';
import type * as Method from '../Method.js';
import type { Config } from './config.js';
import type * as Extension from './Extension.js';
import type { Plugin } from './plugins/plugin.js';
/** Runs configured payment extensions in order and threads credential context between them. */
export declare function preparePayment(challenge: Challenge.Challenge, extensions: readonly Extension.Extension[] | undefined, credentialContext?: unknown): Promise<unknown>;
/** Resolves explicit payment configuration before falling back to built-in plugins. */
export declare function resolvePlugin(challenge: Challenge.Challenge, config?: {
    plugins?: Plugin[] | undefined;
    methods?: any;
}): {
    plugin?: Plugin | undefined;
    method?: Method.AnyClient | undefined;
};
export declare function selectChallenge(challenges: readonly Challenge.Challenge[], config?: Config | undefined): ({
    challenge: Challenge.Challenge;
} & {
    plugin?: Plugin | undefined;
    method?: Method.AnyClient | undefined;
}) | undefined;
export declare function resolveAcceptPayment(config?: Config | undefined): string | undefined;
export declare function flattenConfigMethods(config?: Pick<Config, 'methods'> | undefined): Method.AnyClient[] | undefined;
/** Loads CLI config only from explicit, user-selected paths. */
export declare function loadConfig(configFile?: string | undefined): Promise<{
    config: Config;
    path: string;
} | undefined>;
/** Rejects retry challenges that change the payment the caller approved. */
export declare function assertSamePaymentRequest(approved: Challenge.Challenge, retry: Challenge.Challenge): void;
//# sourceMappingURL=internal.d.ts.map