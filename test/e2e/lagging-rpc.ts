import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A JSON-RPC proxy in front of `upstream` that serves receipts before state, like a public RPC
 * with preconfirmations (Base's Flashblocks on mainnet.base.org): a transaction's receipt is
 * available at once, but `eth_blockNumber` and "latest" reads only reach a block `lagMs` after it
 * was mined, and reads pinned to a newer block fail as on a node that has not sealed it yet.
 */
export async function laggingRpc(upstream: string, lagMs = 1_500) {
  const seen = new Map<bigint, number>();
  const call = async (method: string, params: unknown[]) => {
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await response.json()) as { result?: unknown; error?: unknown };
  };
  const head = async () => BigInt((await call("eth_blockNumber", [])).result as string);
  const note = (block: bigint) => {
    for (let n = block; n >= 0n && !seen.has(n); n -= 1n) seen.set(n, Date.now());
  };
  /** The newest block "latest" reads reach. */
  const sealed = () => {
    let best = 0n;
    for (const [block, at] of seen) if (Date.now() - at >= lagMs && block > best) best = block;
    return best;
  };
  // Every block mined before the proxy started is already sealed.
  seen.set(await head(), 0);
  let polling = true;
  const poll = (async () => {
    while (polling) {
      note(await head().catch(() => -1n));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();

  const answer = async (method: string, params: unknown[]) => {
    const latest = sealed();
    if (method === "eth_blockNumber") return { result: `0x${latest.toString(16)}` };
    if (method === "eth_call" || method === "eth_getBalance") {
      const tag = params[1];
      if (typeof tag === "string" && tag.startsWith("0x") && BigInt(tag) > latest)
        return { error: { code: -32000, message: "header not found" } };
      if (tag === undefined || tag === "latest" || tag === "pending")
        return call(method, [params[0], `0x${latest.toString(16)}`, ...params.slice(2)]);
    }
    return call(method, params);
  };

  const server = createServer(async (request, response) => {
    const body = JSON.parse(await read(request)) as {
      id: unknown;
      method: string;
      params?: unknown[];
    };
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          ...(await answer(body.method, body.params ?? [])),
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      polling = false;
      await poll;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
