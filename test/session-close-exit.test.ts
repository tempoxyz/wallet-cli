import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { Challenge } from "mppx";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { upsertSessionRecord } from "../src/payment/session-store.js";
import { escrowAbi, mainnetEscrow } from "../src/shared/constants.js";
import {
  testAccessKey,
  testWallet,
  testWallet2,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const root = resolve(import.meta.dirname, "..");
const channelId = `0x${"a".repeat(64)}` as const;
const otherChannelId = `0x${"b".repeat(64)}` as const;

describe("session close process exit status", () => {
  it.each(["failed", "mixed", "pending", "closed", "dry-run"] as const)(
    "preserves the %s summary and reports the correct shell status",
    async (scenario) => {
      const home = await useTempHome();
      // No signing key is available: the cooperative failure must occur before payment.
      await writeWalletState(walletState({ accessKeys: [] }));
      const closeRequestedAt = BigInt(Math.floor(Date.now() / 1000));
      const unexpected: string[] = [];
      let rpcCalls = 0;
      let authorizedRequests = 0;
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        if (request.headers.authorization) authorizedRequests += 1;
        if (request.url === "/session") {
          response.statusCode = 503;
          response.end("Use the cached test challenge");
          return;
        }
        try {
          const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            id: number;
            method: string;
            params: [{ data: Hex }];
          };
          if (rpc.method !== "eth_call") throw Error(`Unexpected RPC: ${rpc.method}`);
          rpcCalls += 1;
          const call = decodeFunctionData({ abi: escrowAbi, data: rpc.params[0].data });
          let result: Hex;
          if (call.functionName === "CLOSE_GRACE_PERIOD") {
            result = encodeFunctionResult({
              abi: escrowAbi,
              functionName: "CLOSE_GRACE_PERIOD",
              result: 900n,
            });
          } else if (call.functionName === "getChannel") {
            const finalized =
              scenario === "closed" || (scenario === "mixed" && call.args[0] === channelId);
            result = encodeFunctionResult({
              abi: escrowAbi,
              functionName: "getChannel",
              result: [
                finalized,
                scenario === "pending" ? closeRequestedAt : 0n,
                testWallet,
                testWallet2,
                usdc,
                testAccessKey,
                10_000n,
                2_000n,
              ],
            });
          } else throw Error(`Unexpected contract call: ${call.functionName}`);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
        } catch (error) {
          unexpected.push(String(error));
          response.statusCode = 500;
          response.end("Unexpected fixture request");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw Error("Missing fixture address");
      const origin = `http://127.0.0.1:${address.port}`;
      try {
        const challenge = Challenge.from({
          id: "close-test",
          realm: origin,
          method: "tempo",
          intent: "session",
          request: { amount: "1000", currency: usdc, recipient: testWallet2 },
        });
        for (const id of scenario === "mixed" ? [channelId, otherChannelId] : [channelId]) {
          await upsertSessionRecord({
            accepted_cumulative: 2_000n,
            authorized_signer: testAccessKey,
            chain_id: 4217,
            challenge_echo: JSON.stringify(challenge),
            channel_id: id,
            close_requested_at: 0,
            created_at: 1,
            cumulative_amount: 2_000n,
            deposit: 10_000n,
            escrow_contract: mainnetEscrow,
            grace_ready_at: 0,
            last_used_at: 1,
            network: "tempo",
            origin,
            payee: testWallet2,
            payer: testWallet,
            request_url: `${origin}/session`,
            salt: `0x${"0".repeat(64)}`,
            server_spent: 2_000n,
            session_protocol: "v1",
            state: "active",
            token: usdc,
          });
        }
        const args = [
          "sessions",
          "close",
          origin,
          "--format",
          "json",
          ...(scenario === "pending" ? [] : ["--cooperative"]),
          ...(scenario === "dry-run" ? ["--dry-run"] : []),
        ];
        const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
          (resolve, reject) => {
            execFile(
              process.execPath,
              ["--import", "tsx", "src/cli.ts", ...args],
              {
                cwd: root,
                env: {
                  ...process.env,
                  HOME: home,
                  TEMPO_RPC_URL: `${origin}/rpc`,
                  TEMPO_WALLET_NETWORK: "tempo",
                  NO_COLOR: "1",
                },
                timeout: 10_000,
              },
              (error, stdout, stderr) => {
                if (error && typeof error.code !== "number") return reject(error);
                resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
              },
            );
          },
        );
        const summary = JSON.parse(result.stdout);
        expect(result.stderr).toBe("");
        expect(unexpected).toEqual([]);
        expect(authorizedRequests).toBe(0);
        if (scenario === "dry-run") {
          expect(result.code).toBe(0);
          expect(summary.targets).toHaveLength(1);
          expect(rpcCalls).toBe(0);
        } else {
          const failed = scenario === "failed" || scenario === "mixed";
          expect(result.code).toBe(failed ? 1 : 0);
          expect(summary).toMatchObject({
            failed: failed ? 1 : 0,
            pending: scenario === "pending" ? 1 : 0,
            closed: scenario === "closed" || scenario === "mixed" ? 1 : 0,
          });
          if (failed)
            expect(summary.results).toContainEqual(
              expect.objectContaining({
                status: "error",
                error: "cooperative close requires a local secp256k1 session access key",
              }),
            );
          if (scenario === "pending") expect(summary.results[0].remaining_secs).toBeGreaterThan(0);
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
