import { restoreFetchDispatcher } from "./fetch-dispatcher.js";

export { Agent, EnvHttpProxyAgent, type Dispatcher, fetch, FormData, ProxyAgent } from "undici";

// Keep Node's existing fetch configuration. Our request transport uses Undici
// explicitly with its own dispatcher; RPC and provider calls use built-in fetch.
restoreFetchDispatcher();
