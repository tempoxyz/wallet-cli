/** Map of configuration keys to environment variable names, checked in order. */
declare const variables: {
    readonly realm: readonly ["MPP_REALM", "FLY_APP_NAME", "HEROKU_APP_NAME", "RAILWAY_PUBLIC_DOMAIN", "RENDER_EXTERNAL_HOSTNAME", "VERCEL_URL", "WEBSITE_HOSTNAME"];
    readonly secretKey: readonly ["MPP_SECRET_KEY"];
};
/**
 * Resolves a configuration value from environment variables.
 *
 * Checks platform-specific env vars in order, falling back to a default if one exists.
 *
 * @example
 * ```ts
 * Env.get('realm')     // e.g. "my-app.vercel.app"
 * Env.get('secretKey') // e.g. value of MPP_SECRET_KEY
 * ```
 */
export declare function get(key: keyof typeof variables): string | undefined;
export {};
//# sourceMappingURL=env.d.ts.map