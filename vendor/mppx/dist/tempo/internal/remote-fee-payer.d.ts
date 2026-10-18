/** Configuration for a remote Tempo fee-payer service. */
export type Config = Readonly<{
    /** Custom fetch implementation used only for fee-payer JSON-RPC transport. */
    fetch?: typeof globalThis.fetch | undefined;
    headers?: Readonly<Record<string, string>> | undefined;
    url: string;
}>;
/** Returns whether a value is remote fee-payer configuration. */
export declare function is(value: unknown): value is Config;
/** Normalizes remote fee-payer string and object inputs. */
export declare function from(value: unknown): Config | undefined;
/** Returns a cloned header record while reserving JSON content type for MPPX. */
export declare function resolveHeaders(config: Config): Record<string, string>;
//# sourceMappingURL=remote-fee-payer.d.ts.map