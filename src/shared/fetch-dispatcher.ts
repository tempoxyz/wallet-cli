// Capture this before importing Undici 8: its initialization replaces the v1
// dispatcher used by Node 22's built-in fetch, including its environment proxy.
const dispatcherKey = Symbol.for("undici.globalDispatcher.1");
const dispatcher: unknown = Reflect.get(globalThis, dispatcherKey);

export function restoreFetchDispatcher() {
  if (dispatcher !== undefined) Reflect.set(globalThis, dispatcherKey, dispatcher);
}
