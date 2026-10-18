import type * as Challenge from '../../../Challenge.js';
import type * as Method from '../../../Method.js';
export type Options = {
    config: Record<string, unknown>;
    content: string;
    formatAmount: (request: any) => string | Promise<string>;
    text: Text | undefined;
    theme: Theme | undefined;
};
export type Data<method extends Method.Method = Method.Method, config extends Record<string, unknown> = {}> = {
    label: string;
    rootId: string;
    formattedAmount: string;
    config: config;
    challenge: Challenge.FromMethods<[method]>;
    text: {
        [k in keyof Text]-?: NonNullable<Text[k]>;
    };
    theme: {
        [k in keyof Omit<Theme, 'favicon' | 'fontUrl' | 'logo'>]-?: NonNullable<Theme[k]>;
    };
};
export { attrs, classNames, ids, params } from './constants.js';
declare class CssVar {
    readonly name: string;
    constructor(token: string);
    toString(): string;
}
export declare const vars: {
    readonly accent: CssVar;
    readonly background: CssVar;
    readonly border: CssVar;
    readonly foreground: CssVar;
    readonly muted: CssVar;
    readonly negative: CssVar;
    readonly positive: CssVar;
    readonly surface: CssVar;
    readonly fontFamily: CssVar;
    readonly fontSizeBase: CssVar;
    readonly radius: CssVar;
    readonly spacingUnit: CssVar;
};
export declare const defaultText: {
    readonly expires: 'Expires at';
    readonly pay: 'Pay';
    readonly paymentRequired: 'Payment Required';
    readonly title: 'Payment Required';
};
export type Text = {
    /** Prefix for the expiry line. @default 'Expires at' */
    expires?: string | undefined;
    /** Pay button label. @default 'Pay' */
    pay?: string | undefined;
    /** Badge label. @default 'Payment Required' */
    paymentRequired?: string | undefined;
    /** Page title. @default text.paymentRequired */
    title?: string | undefined;
};
export declare const defaultTheme: {
    readonly colorScheme: 'light dark';
    readonly fontFamily: 'system-ui, -apple-system, sans-serif';
    readonly fontSizeBase: '16px';
    readonly radius: '6px';
    readonly spacingUnit: '2px';
    readonly accent: readonly ["#171717", "#ededed"];
    readonly background: readonly ["#ffffff", "#0a0a0a"];
    readonly border: readonly ["#e5e5e5", "#2e2e2e"];
    readonly foreground: readonly ["#0a0a0a", "#ededed"];
    readonly muted: readonly ["#666666", "#a1a1a1"];
    readonly negative: readonly ["#e5484d", "#e5484d"];
    readonly positive: readonly ["#30a46c", "#30a46c"];
    readonly surface: readonly ["#f5f5f5", "#1a1a1a"];
};
export type Theme = {
    /** Color scheme. @default 'light dark' */
    colorScheme?: 'light' | 'dark' | 'light dark' | undefined;
    /** Font family. @default 'system-ui, -apple-system, sans-serif' */
    fontFamily?: string | undefined;
    /** Base font size. @default '16px' */
    fontSizeBase?: string | undefined;
    /** Font URL to inject (e.g. Google Fonts `<link>`). */
    fontUrl?: string | undefined;
    /** Favicon URL. Light/dark variants supported. Falls back to host's favicon via Google S2 service. */
    favicon?: string | {
        light: string;
        dark: string;
    } | undefined;
    /** Logo URL shown in header. Light/dark variants supported. */
    logo?: string | {
        light: string;
        dark: string;
    } | undefined;
    /** Border radius. @default '6px' */
    radius?: string | undefined;
    /** The base spacing unit that all other spacing is derived from. Increase or decrease this value to make your layout more or less spacious. @default '2px' */
    spacingUnit?: string | undefined;
    /** Accent color (buttons, links). @default ['#171717', '#ededed'] */
    accent?: LightDark | undefined;
    /** Page background. @default ['#ffffff', '#0a0a0a'] */
    background?: LightDark | undefined;
    /** Border color. @default ['#e5e5e5', '#2e2e2e'] */
    border?: LightDark | undefined;
    /** Primary text/content color. @default ['#0a0a0a', '#ededed'] */
    foreground?: LightDark | undefined;
    /** Secondary/muted text. @default ['#666666', '#a1a1a1'] */
    muted?: LightDark | undefined;
    /** Error/danger color. @default ['#e5484d', '#e5484d'] */
    negative?: LightDark | undefined;
    /** Success color. @default ['#30a46c', '#30a46c'] */
    positive?: LightDark | undefined;
    /** Input/card surface. @default ['#f5f5f5', '#1a1a1a'] */
    surface?: LightDark | undefined;
};
export type Config = {
    text?: Text | undefined;
    theme?: Theme | undefined;
};
type LightDark = string | readonly [light: string, dark: string];
export declare function resolveOptions(options: Options): {
    theme: ResolvedTheme;
    text: ResolvedText;
};
type ResolvedTheme = {
    [k in keyof Omit<Theme, 'favicon' | 'fontUrl' | 'logo'>]-?: NonNullable<Theme[k]>;
} & Pick<Theme, 'favicon' | 'fontUrl' | 'logo'>;
type ResolvedText = {
    [k in keyof Text]-?: NonNullable<Text[k]>;
};
export declare function render(options: {
    entries: readonly {
        challenge: Challenge.Challenge;
        content: string;
    }[];
    dataMap: Record<string, Data>;
    formattedAmount: string;
    /** Whether to render panel wrappers around each entry. @default entries.length > 1 */
    panels?: boolean | undefined;
    text: ResolvedText;
    theme: ResolvedTheme;
}): string;
export declare function mergeDefined<type>(defaults: type, value: DeepPartial<type> | undefined): type;
type DeepPartial<type> = {
    [key in keyof type]?: type[key] extends readonly unknown[] ? type[key] | undefined : type[key] extends object ? DeepPartial<type[key]> | undefined : type[key] | undefined;
};
//# sourceMappingURL=config.d.ts.map