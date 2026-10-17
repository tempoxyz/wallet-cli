import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { Challenge } from "mppx";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readSessionRecordsByOrigin, upsertSessionRecord } from "../src/payment/session-store.js";
import { escrowAbi, mainnetEscrow } from "../src/shared/constants.js";
import {
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";
import { cliBundle } from "./cli-bundle.js";

const root = resolve(import.meta.dirname, "..");
const channelId = `0x${"a".repeat(64)}` as const;
const otherChannelId = `0x${"b".repeat(64)}` as const;

describe("session close process exit status", () => {
  it.each(["failed", "mixed", "pending", "closed", "dry-run"] as const)(
    "preserves the %s summary and reports the correct shell status",
    async (scenario) => {
      const home = await useTempHome();
      // The wallet's only key is not the channel's signer: the cooperative failure must occur
      // before payment.
      await writeWalletState(
        walletState({
          accessKeys: [
            {
              ...walletState().accessKeys[0]!,
              address: testAccessKey2,
              privateKey: testPrivateKey2,
            },
          ],
        }),
      );
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
          // The RPC is on mainnet, so the session reads pass the TEMPO_RPC_URL check.
          if (rpc.method === "eth_chainId") {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x1079" }));
            return;
          }
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
          ...(scenario === "dry-run" ? ["--dry-run"] : ["--yes"]),
        ];
        const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
          (resolve, reject) => {
            execFile(
              process.execPath,
              [cliBundle("wallet"), ...args],
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
          if (scenario === "pending") {
            expect(summary.results[0].remaining_secs).toBeGreaterThan(0);
            expect(summary._next.argv).toEqual([
              "tempo",
              "wallet",
              "sessions",
              "close",
              channelId,
              "--yes",
              "--network",
              "mainnet",
            ]);
          } else expect(summary).not.toHaveProperty("_next");
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});

describe("session close confirmation", () => {
  const prompt = "Close this session? This cannot be undone. [y/N] ";
  const confirmed = `tempo wallet sessions close ${channelId} --yes --network mainnet`;
  const declined = "Sessions not closed: not confirmed at the prompt";
  // The escrow reports the channel finalized, so a close that goes ahead removes the record
  // after one read and sends no transaction.
  let rpcCalls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id: number;
      method: string;
    };
    response.setHeader("content-type", "application/json");
    // The RPC is on mainnet, so the session reads pass the TEMPO_RPC_URL check.
    if (rpc.method === "eth_chainId")
      return response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x1079" }));
    rpcCalls += 1;
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: encodeFunctionResult({
          abi: escrowAbi,
          functionName: "getChannel",
          result: [true, 0n, testWallet, testWallet2, usdc, testAccessKey, 10_000n, 2_000n],
        }),
      }),
    );
  });
  let origin = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing fixture address");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each<{
    name: string;
    args?: string[];
    terminal?: "stdout" | "stdin and stdout";
    input?: string;
    prompted?: boolean;
    refused?: string;
    output?: string;
    closed?: boolean;
  }>([
    { name: "an agent run without --yes refuses with the confirmed command", refused: confirmed },
    { name: "an agent run with --yes closes", args: ["--yes"], closed: true },
    // Piped input is not a person answering, even when output goes to a terminal.
    {
      name: "a terminal run with piped stdin refuses without --yes, ignoring the input",
      terminal: "stdout",
      input: "y\n",
      refused: confirmed,
    },
    {
      name: "an interactive run declined at the prompt closes nothing",
      terminal: "stdin and stdout",
      input: "n\n",
      prompted: true,
      refused: declined,
    },
    {
      name: "an interactive run confirmed at the prompt closes",
      terminal: "stdin and stdout",
      input: "y\n",
      prompted: true,
      closed: true,
    },
    {
      name: "an interactive dry run does not prompt and continues with --yes",
      args: ["--dry-run"],
      terminal: "stdin and stdout",
      output: confirmed,
    },
  ])(
    "$name",
    async ({ args = [], terminal, input = "", prompted = false, refused, output, closed }) => {
      const home = await useTempHome();
      await writeWalletState(walletState());
      await upsertSessionRecord({
        accepted_cumulative: 2_000n,
        authorized_signer: testAccessKey,
        chain_id: 4217,
        challenge_echo: "{}",
        channel_id: channelId,
        close_requested_at: 0,
        created_at: 1,
        cumulative_amount: 2_000n,
        deposit: 10_000n,
        escrow_contract: mainnetEscrow,
        grace_ready_at: 0,
        last_used_at: 1,
        network: "tempo",
        origin: "https://service.example",
        payee: testWallet2,
        payer: testWallet,
        request_url: "https://service.example/session",
        salt: `0x${"0".repeat(64)}`,
        server_spent: 2_000n,
        session_protocol: "v1",
        state: "active",
        token: usdc,
      });
      rpcCalls = 0;

      const result = await walletCli(["sessions", "close", channelId, ...args], {
        home,
        input,
        rpc: origin,
        terminal,
      });

      expect(result.stderr.includes(prompt), JSON.stringify(result)).toBe(prompted);
      if (prompted) expect(result.stderr).toContain(`  - channel: ${channelId}\n`);
      if (refused) {
        expect(result.code).toBe(2);
        expect(result.stdout).toContain(refused);
      } else expect(result.code).toBe(0);
      if (output) expect(result.stdout).toContain(output);
      expect(rpcCalls > 0).toBe(Boolean(closed));
      expect(
        (await readSessionRecordsByOrigin("https://service.example")).map(
          (record) => record.channel_id,
        ),
      ).toEqual(closed ? [] : [channelId]);
    },
    30_000,
  );

  /**
   * Runs the wallet CLI as an agent (`--format json`), or with output to a `terminal`, and with
   * stdin a terminal too when it names both.
   */
  function walletCli(
    args: string[],
    options: {
      home: string;
      input: string;
      rpc: string;
      terminal: "stdout" | "stdin and stdout" | undefined;
    },
  ) {
    const fixture =
      options.terminal === "stdout" ? "interactive-stdout.mjs" : "interactive-terminal.mjs";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: options.home,
      NO_COLOR: "1",
      TEMPO_RPC_URL: options.rpc,
    };
    delete env.TEMPO_PRIVATE_KEY;
    delete env.TEMPO_WALLET_NETWORK;
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        options.terminal
          ? ["--import", join(root, "test", "fixtures", fixture), cliBundle("wallet"), ...args]
          : [cliBundle("wallet"), ...args, "--format", "json"],
        { cwd: root, env, timeout: 20_000 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") return reject(error);
          resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
        },
      );
      child.stdin?.end(options.input);
    });
  }
});
