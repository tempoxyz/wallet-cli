import type { DiscoveryHandler } from '../../discovery/OpenApi.js';
import type * as Method from '../../Method.js';
import type * as Mppx from '../../server/Mppx.js';
export type AnyMethodFn = Mppx.AnyMethodFn;
export type AnyServer = Method.AnyServer;
type DiscoveryMeta = Pick<DiscoveryHandler, '_internal'>;
/** Recursively wraps nested handler objects one level deep. */
type WrapNested<obj, handler> = {
    [key in keyof obj]: obj[key] extends (options: infer options) => any ? WrappedMethod<obj[key], options, handler> : obj[key];
};
type WrappedMethod<method, options, handler> = ((o: options) => handler & DiscoveryMeta) & Omit<method, keyof Function>;
export type Wrap<mppx, handler> = {
    [key in keyof mppx as key extends 'compose' ? never : key]: key extends Mppx.ReservedKey ? mppx[key] : mppx[key] extends (options: infer options) => any ? WrappedMethod<mppx[key], options, handler> : mppx[key] extends Record<string, (options: any) => any> ? WrapNested<mppx[key], handler> : mppx[key];
};
/**
 * Wraps a payment handler so each method returns a framework-specific
 * handler instead of the raw method response.
 *
 * @param mppx - The payment handler created by `Mppx.create`.
 * @param wrapper - A function that adapts a method function into a framework handler.
 */
export declare function wrap<mppx extends Mppx.Mppx<any, any>, handler>(mppx: mppx, wrapper: (method: AnyMethodFn, options: any) => handler): Wrap<mppx, handler>;
export {};
//# sourceMappingURL=mppx.d.ts.map