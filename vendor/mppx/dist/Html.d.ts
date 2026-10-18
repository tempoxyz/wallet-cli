import type * as Method from './Method.js';
import { type Config, type Data, type Text, type Theme, vars } from './server/internal/html/config.js';
export declare function init<method extends Method.Method = Method.Method, config extends Record<string, unknown> = {}>(methodName: method['name']): Context<method, config>;
export type Context<method extends Method.Method = Method.Method, config extends Record<string, unknown> = {}> = Data<method, config> & {
    error: (message?: string | null | undefined) => void;
    root: HTMLElement;
    submit: (credential: string) => Promise<void>;
    vars: typeof vars;
};
export type { Config, Text, Theme };
//# sourceMappingURL=Html.d.ts.map