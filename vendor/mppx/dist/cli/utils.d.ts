import type { Chain } from 'viem';
import { type Address, createClient } from 'viem';
export declare const pc: {
    isColorSupported: boolean;
    reset: (input: unknown) => string;
    bold: (input: unknown) => string;
    dim: (input: unknown) => string;
    italic: (input: unknown) => string;
    underline: (input: unknown) => string;
    inverse: (input: unknown) => string;
    hidden: (input: unknown) => string;
    strikethrough: (input: unknown) => string;
    black: (input: unknown) => string;
    red: (input: unknown) => string;
    green: (input: unknown) => string;
    yellow: (input: unknown) => string;
    blue: (input: unknown) => string;
    magenta: (input: unknown) => string;
    cyan: (input: unknown) => string;
    white: (input: unknown) => string;
    gray: (input: unknown) => string;
    bgBlack: (input: unknown) => string;
    bgRed: (input: unknown) => string;
    bgGreen: (input: unknown) => string;
    bgYellow: (input: unknown) => string;
    bgBlue: (input: unknown) => string;
    bgMagenta: (input: unknown) => string;
    bgCyan: (input: unknown) => string;
    bgWhite: (input: unknown) => string;
    blackBright: (input: unknown) => string;
    redBright: (input: unknown) => string;
    greenBright: (input: unknown) => string;
    yellowBright: (input: unknown) => string;
    blueBright: (input: unknown) => string;
    magentaBright: (input: unknown) => string;
    cyanBright: (input: unknown) => string;
    whiteBright: (input: unknown) => string;
    bgBlackBright: (input: unknown) => string;
    bgRedBright: (input: unknown) => string;
    bgGreenBright: (input: unknown) => string;
    bgYellowBright: (input: unknown) => string;
    bgBlueBright: (input: unknown) => string;
    bgMagentaBright: (input: unknown) => string;
    bgCyanBright: (input: unknown) => string;
    bgWhiteBright: (input: unknown) => string;
    link(url: string, text: string, noUnderline?: boolean): string;
};
export declare function printRequestHeaders(reqUrl: string, init: RequestInit, info: (msg: string) => void): void;
export declare function printResponseHeaders(res: Response, opts: {
    include: boolean;
    verbose: number;
    silent: boolean;
}): void;
export declare function fmtRequestValue(key: string, value: unknown, ctx: {
    tokenSymbol: string;
    tokenDecimals: number;
    explorerUrl?: string | undefined;
}): string;
export declare function decodeMemo(hex: string): string | undefined;
export declare function fmtChallengeValue(key: string, value: unknown): string;
export declare function link(url: string, text: string): string;
export declare function parseMethodOpts(raw: string | string[] | undefined): Record<string, string>;
/** Returns true when the CLI is running inside an agent wrapper that prefers machine-readable output. */
export declare function isAgentEnvironment(env?: NodeJS.ProcessEnv): boolean;
export declare function isTempoAccount(accountName: string): boolean;
export declare function prompt(message: string): Promise<string | undefined>;
export declare function confirm(prompt: string, defaultYes?: boolean): Promise<boolean>;
export declare function fmtBalance(b: bigint, symbol: string, decimals?: number, opts?: {
    explorerUrl?: string | undefined;
    token?: string | undefined;
}): string;
export type Network = 'mainnet' | 'testnet';
export declare const networkRpcUrls: {
    readonly mainnet: "https://rpc.tempo.xyz";
    readonly testnet: "https://rpc.moderato.tempo.xyz";
};
/** Resolve RPC URL from explicit option, network option, then MPPX_RPC_URL/RPC_URL env vars. */
export declare function resolveRpcUrl(explicit?: string | undefined, options?: {
    network?: Network | undefined;
}): string | undefined;
/** Select the default network for faucet funding without overriding explicit RPC configuration. */
export declare function resolveFundingNetwork(options?: {
    network?: Network | undefined;
    rpcUrl?: string | undefined;
}): Network | undefined;
export declare function resolveChain(opts?: {
    network?: Network | undefined;
    rpcUrl?: string | undefined;
}): Promise<Chain>;
export declare function chainName(chain: {
    id: number;
    name: string;
}): string;
export declare const pathUsd: Address;
export declare const usdc: Address;
export declare const mainnetTokens: readonly [`0x${string}`, `0x${string}`];
export declare const testnetTokens: readonly ['0x20c0000000000000000000000000000000000000', '0x20c0000000000000000000000000000000000001', '0x20c0000000000000000000000000000000000002', '0x20c0000000000000000000000000000000000003'];
export declare function isTestnet(chain: Chain): boolean;
export declare function fetchTokenInfo(client: ReturnType<typeof createClient>, token: Address, account: Address): Promise<{
    balance: bigint;
    decimals: number;
    symbol: string;
    token: Address;
}>;
export declare function fetchBalanceLines(address: Address, opts?: {
    chain?: Chain;
    rpcUrl?: string;
    includeTestnet?: boolean;
}): Promise<string[]>;
//# sourceMappingURL=utils.d.ts.map