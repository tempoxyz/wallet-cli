import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function proxyFixture() {
  async function respond(req: IncomingMessage, res: ServerResponse) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body) as { id: number; method: string };
    expect(rpc.method).toBe("eth_chainId");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x1079" }));
  }
  const origin = createServer(respond);
  const sockets = new Set<Duplex>();
  let proxyRequests = 0;
  // Node 22 tunnels HTTP through CONNECT; Undici 8 forwards HTTP requests.
  const proxy = createServer((req, res) => {
    proxyRequests++;
    void respond(req, res);
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  const originAddress = origin.address();
  if (!originAddress || typeof originAddress === "string") throw new Error("Missing origin");
  proxy.on("connect", (_req, socket, head) => {
    proxyRequests++;
    const upstream = connect(originAddress.port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    sockets.add(upstream);
    sockets.add(socket);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    origin.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all(
      [origin, proxy].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  });
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy");
  return {
    proxy: `http://127.0.0.1:${address.port}`,
    origin: `http://127.0.0.1:${originAddress.port}`,
    proxyRequests: () => proxyRequests,
  };
}

async function child(script: string, proxy: string, noProxy = "", useProxy = "1") {
  return execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    timeout: 5000,
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: useProxy,
      HTTP_PROXY: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    },
  });
}

const rpcFetch = `async function chainId(url) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(2000),
  });
  return (await response.json()).result;
}`;

it.each(["shared/undici", "commands/request"])(
  "preserves built-in fetch and viem environment proxies after importing %s",
  async (module) => {
    const fixture = await proxyFixture();
    const { stdout } = await child(
      `${rpcFetch}
      const url = 'http://proxy-only.invalid';
      const before = await chainId(url);
      await import('./src/${module}.ts');
      const after = await chainId(url);
      const { createPublicClient, http } = await import('viem');
      const rpc = await createPublicClient({ transport: http(url, { retryCount: 0 }) }).getChainId();
      console.log(JSON.stringify({ before, after, rpc }));`,
      fixture.proxy,
    );
    expect(JSON.parse(stdout)).toEqual({ before: "0x1079", after: "0x1079", rpc: 4217 });
    expect(fixture.proxyRequests()).toBeGreaterThan(0);
  },
);

it("preserves NO_PROXY bypass for built-in fetch", async () => {
  const fixture = await proxyFixture();
  const { stdout } = await child(
    `${rpcFetch}
    await import('./src/shared/undici.ts');
    console.log(await chainId(${JSON.stringify(fixture.origin)}));`,
    fixture.proxy,
    "127.0.0.1",
  );
  expect(stdout.trim()).toBe("0x1079");
  expect(fixture.proxyRequests()).toBe(0);
});

it("does not opt built-in fetch into environment proxies when disabled", async () => {
  const fixture = await proxyFixture();
  const { stdout } = await child(
    `${rpcFetch}
    await import('./src/shared/undici.ts');
    try {
      await chainId('http://proxy-only.invalid');
      console.log('unexpected proxy request');
    } catch {
      console.log('direct request failed');
    }`,
    fixture.proxy,
    "",
    "0",
  );
  expect(stdout.trim()).toBe("direct request failed");
  expect(fixture.proxyRequests()).toBe(0);
});

it("keeps explicit Undici request proxies working independently", async () => {
  const fixture = await proxyFixture();
  const { stdout } = await child(
    `const { fetch, EnvHttpProxyAgent } = await import('./src/shared/undici.ts');
    const dispatcher = new EnvHttpProxyAgent();
    try {
      const response = await fetch('http://proxy-only.invalid', {
        dispatcher, method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(2000),
      });
      console.log((await response.json()).result);
    } finally {
      await dispatcher.close();
    }`,
    fixture.proxy,
    "",
    "0",
  );
  expect(stdout.trim()).toBe("0x1079");
  expect(fixture.proxyRequests()).toBeGreaterThan(0);
});

it("preserves a custom legacy dispatcher without replacing Undici's v2 dispatcher", async () => {
  const { stdout } = await child(
    `const key = Symbol.for('undici.globalDispatcher.1');
    const original = Reflect.get(globalThis, key);
    const custom = { dispatch(...args) { return original.dispatch(...args); } };
    Reflect.set(globalThis, key, custom);
    await import('./src/shared/undici.ts');
    const { getGlobalDispatcher, Agent } = await import('undici');
    console.log(JSON.stringify({ preserved: Reflect.get(globalThis, key) === custom,
      independent: getGlobalDispatcher() instanceof Agent }));`,
    "",
  );
  expect(JSON.parse(stdout)).toEqual({ preserved: true, independent: true });
});
