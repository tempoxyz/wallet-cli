const handlers = new WeakMap();
const attempts = new WeakMap();
/** Registers an internal response adapter without changing the public method shape. */
export function register(method, handler) {
    handlers.set(method, handler);
    return method;
}
/** Removes response handling from a method whose caller owns the response lifecycle. */
export function unregister(method) {
    handlers.delete(method);
}
/** Adds response lifecycle state to internal credential parameters. */
export function attachAttempt(method, parameters, attempt) {
    if (handlers.has(method))
        attempts.set(parameters, attempt);
}
/** Reads response lifecycle state when Fetch owns this credential. */
export function getAttempt(parameters) {
    return attempts.get(parameters);
}
/** Lets the selected client method handle a successful paid response. */
export function handle(method, parameters) {
    return Promise.resolve(handlers.get(method)?.(parameters) ?? parameters.response);
}
//# sourceMappingURL=MethodResponse.js.map