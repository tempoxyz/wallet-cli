import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { useTempHome, walletState, writeWalletState } from "./helpers.js";

const execFileAsync = promisify(execFile);

it("reports unknown RPC balances separately from funded and verified zero balances through whoami", async () => {
  const home = await useTempHome();
  await writeWalletState(walletState());
  let mode: "funded" | "failed" | "zero" = "funded";
  let calls = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end("[]");
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string };
      expect(rpc.method).toBe("eth_call");
      calls++;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          ...(mode === "failed"
            ? { error: { code: -32602, message: "Fixture RPC unavailable" } }
            : {
                result: `0x${(mode === "funded" ? 5_000_000n : 0n).toString(16).padStart(64, "0")}`,
              }),
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No RPC address");
    const whoami = async () => {
      const result = await execFileAsync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "whoami", "--format", "json"],
        {
          env: {
            ...process.env,
            HOME: home,
            TEMPO_AUTH_URL: `http://127.0.0.1:${address.port}`,
            TEMPO_RPC_URL: `http://127.0.0.1:${address.port}`,
            TEMPO_WALLET_NETWORK: "mainnet",
          },
        },
      );
      return JSON.parse(result.stdout);
    };
    expect(await whoami()).toMatchObject({
      ready: true,
      balance: { available: "5", total: "5.000000" },
      key: { balance: "5" },
    });
    mode = "failed";
    expect(await whoami()).toMatchObject({
      ready: false,
      balance: { available: null, total: null, error: { code: "E_RPC" } },
      key: { balance: null },
    });
    mode = "zero";
    const zero = await whoami();
    expect(zero).toMatchObject({
      ready: true,
      balance: { available: "0", total: "0.000000" },
      key: { balance: "0" },
    });
    expect(zero.balance).not.toHaveProperty("error");
    expect(calls).toBe(3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);
