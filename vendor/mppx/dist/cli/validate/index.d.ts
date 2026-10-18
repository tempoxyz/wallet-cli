import { Cli } from 'incur';
declare const validate: Cli.Cli<{
    validate: {
        args: {
            url: string;
        };
        options: {
            endpoint?: string | undefined;
            body?: string | undefined;
            query?: string[] | undefined;
            header?: string[] | undefined;
            verbose: number;
            yes: boolean;
            outputJson: boolean;
        };
    };
}, undefined, undefined, undefined, "validate">;
export default validate;
//# sourceMappingURL=index.d.ts.map