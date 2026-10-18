import { Cli } from 'incur';
declare const cli: Cli.Cli<{
    mppx: {
        args: {
            url: string;
        };
        options: {
            account?: string | undefined;
            autoSwap?: boolean | undefined;
            config?: string | undefined;
            confirm: boolean;
            currency?: string | undefined;
            data?: string | undefined;
            fail?: boolean | undefined;
            header?: string[] | undefined;
            include?: boolean | undefined;
            insecure?: boolean | undefined;
            jsonBody?: string | undefined;
            location?: boolean | undefined;
            method?: string | undefined;
            methodOpt?: string[] | undefined;
            network?: "mainnet" | "testnet" | undefined;
            payWith?: string | undefined;
            protocol: "auto" | "mpp" | "x402";
            rpcUrl?: string | undefined;
            session: string;
            silent: boolean;
            slippage?: number | undefined;
            userAgent?: string | undefined;
            verbose: number;
        };
    };
}, undefined, undefined, undefined, "mppx">;
export default cli;
//# sourceMappingURL=cli.d.ts.map