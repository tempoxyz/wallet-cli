import { reservedMppxKeys } from '../../server/Mppx.js';
/**
 * Wraps a payment handler so each method returns a framework-specific
 * handler instead of the raw method response.
 *
 * @param mppx - The payment handler created by `Mppx.create`.
 * @param wrapper - A function that adapts a method function into a framework handler.
 */
export function wrap(mppx, wrapper) {
    const { compose: _, ...rest } = mppx;
    const result = { ...rest };
    for (const mi of mppx.methods) {
        const key = `${mi.name}/${mi.intent}`;
        const methodFn = mppx[key];
        const wrapWithMeta = (options) => {
            const configured = methodFn(options);
            const handler = wrapper(methodFn, options);
            if (configured._internal)
                handler._internal = configured._internal;
            return handler;
        };
        Object.assign(wrapWithMeta, methodFn);
        result[key] = wrapWithMeta;
        // Also set shorthand intent key, using the core-composed handler on collisions.
        if (!reservedMppxKeys.has(mi.intent) && mppx[mi.intent]) {
            const intentFn = mppx[mi.intent];
            if (intentFn === methodFn)
                result[mi.intent] = wrapWithMeta;
            else {
                const wrapIntentWithMeta = (options) => {
                    const configured = intentFn(options);
                    const handler = wrapper(intentFn, options);
                    if (configured._internal)
                        handler._internal = configured._internal;
                    return handler;
                };
                Object.assign(wrapIntentWithMeta, intentFn);
                result[mi.intent] = wrapIntentWithMeta;
            }
        }
        // Build nested handlers: wrapped.tempo.charge(...)
        if (!result[mi.name] || typeof result[mi.name] !== 'object')
            result[mi.name] = {};
        result[mi.name][mi.intent] = wrapWithMeta;
    }
    return result;
}
//# sourceMappingURL=mppx.js.map