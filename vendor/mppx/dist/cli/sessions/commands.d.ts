import { Cli } from 'incur';
/** Normalizes persistent session failures for CLI output. */
export declare function sessionCommandError(error: unknown, fallbackCode: string): never;
declare const sessions: Cli.Cli<{
    list: {
        args: {};
        options: {
            account?: string | undefined;
            network?: "mainnet" | "testnet" | undefined;
        };
    };
} & {
    view: {
        args: {
            channelId: string;
        };
        options: {};
    };
} & {
    close: {
        args: {
            channelId?: string | undefined;
        };
        options: {
            account?: string | undefined;
            all: boolean;
            header?: string[] | undefined;
            network?: "mainnet" | "testnet" | undefined;
            rpcUrl?: string | undefined;
            url?: string | undefined;
            yes: boolean;
        };
    };
}, undefined, undefined, undefined, "sessions">;
export default sessions;
//# sourceMappingURL=commands.d.ts.map