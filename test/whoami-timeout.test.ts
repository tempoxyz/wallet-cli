import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { useTempHome, walletState, writeWalletState } from "./helpers.js";

it.each(["rpc", "assets", "asset body"] as const)(
  "whoami returns when the %s response stalls",
  async (stalled) => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    let rpcCalls = 0;
    let assetCalls = 0;
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        assetCalls++;
        if (stalled === "assets") return;
        response.writeHead(200, { "Content-Type": "application/json" });
        if (stalled === "asset body") {
          response.write("[");
          return;
        }
        response.end("[]");
        return;
      }
      rpcCalls++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString()) as { id: number };
      if (stalled === "rpc") return;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: `0x${5_000_000n.toString(16).padStart(64, "0")}`,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server address");
      const url = `http://127.0.0.1:${address.port}`;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "whoami", "--json"],
        {
          cwd: resolve(import.meta.dirname, ".."),
          env: { ...process.env, HOME: home, TEMPO_RPC_URL: url, TEMPO_AUTH_URL: url },
          // Allow startup overhead while rejecting the old 40-second RPC retry path.
          timeout: 10_000,
        },
      );
      const output = JSON.parse(stdout);
      expect(rpcCalls).toBe(1);
      expect(assetCalls).toBe(1);
      if (stalled === "rpc") {
        expect(output).toMatchObject({
          ready: false,
          balance: { available: null, error: { code: "E_RPC" } },
        });
      } else {
        expect(output).toMatchObject({
          ready: true,
          balance: { available: "5" },
          balances: [{ balance: "5" }],
        });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  15_000,
);
