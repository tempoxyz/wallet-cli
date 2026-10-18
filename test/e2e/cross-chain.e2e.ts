import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";

import { cliEnv, runCli, startCli } from "./cli.js";
import { evmBalance, evmClient, tempoBalance } from "./localnet.js";
import { type HostileQuote, type StandInRelay, standInRelay } from "./relay.js";
import { evmServer, type LocalServer, serve } from "./servers.js";
import { type LocalWallet, localWallet } from "./wallet.js";

const net = inject("localnet");
const cleanup: (() => Promise<void>)[] = [];
let relay: StandInRelay;

beforeEach(async () => {
  relay = await standInRelay(net);
  cleanup.push(() => relay.close());
});

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function started(server: LocalServer) {
  cleanup.push(() => server.close());
  return server;
}

/** An x402 endpoint on the local EVM chain, priced at 0.10 USDC, whose seller settles itself. */
async function x402Endpoint() {
  const account = privateKeyToAccount(generatePrivateKey());
  const chain = evmClient(net);
  await chain.waitForTransactionReceipt({
    hash: await chain.sendTransaction({ to: account.address, value: 10n ** 18n }),
  });
  const server = await started(
    await serve(evmServer(net, { account, amount: "0.10", x402Only: true })),
  );
  return { url: `${server.origin}/paid`, seller: account.address };
}

function env(wallet: LocalWallet, extra: Record<string, string> = {}) {
  return cliEnv(net, wallet, { TEMPO_FUNDING: "auto", TEMPO_RELAY_URL: relay.url, ...extra });
}

const output = (run: { stdout: string; stderr: string }) => run.stdout + run.stderr;

describe("cross-chain funding", () => {
  test("pays an x402 charge on the EVM chain, bridged from OUSD through the relay", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(result.stderr).toMatch(
      /^Bridging 0\.1013 OUSD to 0x[0-9a-fA-F]{40} on local-evm via Relay \(request 0x[0-9a-f]{64}\)$/m,
    );
    expect(result.stderr).toMatch(/^Paid 0\.1 USDC$/m);
    expect(relay.deposited).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
    // One deposit of the quoted input, plus the deposit's fee in OUSD.
    const spent = 1_000_000n - (await tempoBalance(net, net.ousd, wallet.address));
    expect(spent).toBeGreaterThanOrEqual(101_300n);
    expect(spent).toBeLessThan(101_300n + 20_000n);
    // The payment used the funding, so nothing is left to recover.
    const list = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(list.stdout)).toMatchObject({ total: 0 });
  });

  test.each<HostileQuote>([
    "wrong-destination-recipient",
    "wrong-chain",
    "extra-step",
    "arbitrary-contract",
    "amount-above-bound",
    "expired",
    "non-canonical-amount",
    "wrong-deposit-recipient",
  ])("rejects a %s quote before signing anything", async (mode) => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    relay.hostile(mode);

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result.code).toBe(4);
    expect(output(result)).toContain("E_PAYMENT");
    expect(output(result)).not.toContain("Bridging");
    expect(relay.quotes).toHaveLength(1);
    expect(relay.deposited).toHaveLength(0);
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
  });

  test("refuses funding above --max-funding-spend before signing", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();

    const result = await runCli(
      "request",
      ["--max-funding-spend", "0.1", endpoint.url],
      env(wallet),
    );

    expect(result.code).toBe(4);
    expect(output(result)).toContain("E_LIMIT_EXCEEDED");
    expect(output(result)).toContain("--max-funding-spend 0.1213");
    expect(relay.deposited).toHaveLength(0);
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
  });

  test("recovers after the CLI is killed mid-bridge without bridging again", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    relay.hold(true);

    const first = startCli("request", [endpoint.url], env(wallet));
    await relay.waitForDeposits(1);
    first.child.kill("SIGKILL");
    expect((await first.done).signal).toBe("SIGKILL");

    // The interrupted funding is listed, then delivered once the relay releases it.
    const listed = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    const [operation] = (
      JSON.parse(listed.stdout) as { operations: { id: string; status: string }[] }
    ).operations;
    expect(operation).toMatchObject({ status: expect.stringMatching(/claimed|submitted/) });
    const pending = await runCli(
      "wallet",
      ["funding", "recover", operation!.id, "--format", "json"],
      env(wallet),
    );
    expect(JSON.parse(pending.stdout)).toMatchObject({ id: operation!.id, status: "pending" });
    relay.hold(false);

    const rerun = await runCli("request", [endpoint.url], env(wallet));

    expect(rerun).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(rerun.stderr).not.toContain("Bridging");
    expect(relay.quotes).toHaveLength(1);
    expect(relay.deposited).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
  });

  test("reports a refunded bridge as an unknown outcome, then recover settles it", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    relay.refund(true);

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result.code).toBe(4);
    expect(output(result)).toContain("E_PAYMENT_OUTCOME_UNKNOWN");
    const id = /tempo wallet funding recover ([0-9a-f-]{36})/.exec(output(result))?.[1];
    expect(id).toBeDefined();
    const recovered = await runCli(
      "wallet",
      ["funding", "recover", id!, "--format", "json"],
      env(wallet),
    );
    expect(JSON.parse(recovered.stdout)).toMatchObject({ id, status: "refunded" });
    const list = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(list.stdout)).toMatchObject({ total: 0 });
    const unknown = await runCli(
      "wallet",
      ["funding", "recover", "nope", "--format", "json"],
      env(wallet),
    );
    expect(unknown.code).toBe(2);
    expect(output(unknown)).toContain("E_NOT_FOUND");
  });
});
