export { resolveAccount } from './account.js';
export * as Extension from './Extension.js';
/**
 * Define mppx configuration file
 *
 * @example Add plugins for more custom logging/handling (default: [stripe(), tempo()])
 * ```ts
 * // mppx.config.ts
 * import { defineConfig } from 'mppx/cli'
 * import { tempo } from 'mppx/cli/plugins'
 *
 * export default defineConfig({
 *   plugins: [tempo()],
 * })
 * ```
 *
 * @example Add client methods to extend mppx support (e.g. third-party mppx packages)
 * ```ts
 * // mppx.config.ts
 * import { defineConfig, resolveAccount } from 'mppx/cli'
 * import { tempo } from 'mppx/client'
 *
 * export default defineConfig({
 *   methods: [tempo({ account: await resolveAccount() })],
 * })
 * ```
 */
export function defineConfig(config) {
    return config;
}
//# sourceMappingURL=config.js.map