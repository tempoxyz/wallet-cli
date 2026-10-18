const handlers = new WeakMap();
/** Registers an internal challenge hook without changing the public method shape. */
export function register(method, handler) {
    handlers.set(method, handler);
    return method;
}
/** Returns whether a method registered pre-credential work. */
export function has(method) {
    return handlers.has(method);
}
/** Runs method-specific work before creating a challenge credential. */
export function handle(method, parameters) {
    return Promise.resolve(handlers.get(method)?.(parameters));
}
//# sourceMappingURL=MethodChallenge.js.map