const internals = new WeakMap();
/** @internal Registers private transport and recovery hooks for a session manager. */
export function registerSessionManagerInternals(manager, value) {
    internals.set(manager, value);
}
/** @internal Returns private transport and recovery hooks for a session manager. */
export function getSessionManagerInternals(manager) {
    const value = internals.get(manager);
    if (!value)
        throw new Error('Session manager internals are unavailable.');
    return value;
}
//# sourceMappingURL=SessionManager.js.map