import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, test } from "vitest";

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { cliEnv, runCli, startCli } from "./cli.js";
import { evmBalance, evmClient, tempoBalance } from "./localnet.js";
import { type HostileQuote, type StandInRelay, standInRelay } from "./relay.js";
import { type StandInStargate, standInStargate } from "./stargate.js";
import { evmServer, type LocalServer, serve } from "./servers.js";
import { type LocalWallet, localWallet } from "./wallet.js";

const net = inject("localnet");
const cleanup: (() => Promise<void>)[] = [];
let relay: StandInRelay;
let stargate: StandInStargate;

beforeEach(async () => {
  relay = await standInRelay(net);
  cleanup.push(() => relay.close());
  stargate = await standInStargate(net);
  cleanup.push(() => stargate.close());
});

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function started(server: LocalServer) {
  cleanup.push(() => server.close());
  return server;
}

/** An x402 endpoint on the local EVM chain, priced at 0.10 USDC, whose seller settles itself. */
async function x402Endpoint(
  options: Pick<Parameters<typeof evmServer>[1], "rejectPaid" | "afterSettle"> = {},
) {
  const account = privateKeyToAccount(generatePrivateKey());
  const chain = evmClient(net);
  await chain.waitForTransactionReceipt({
    hash: await chain.sendTransaction({ to: account.address, value: 10n ** 18n }),
  });
  const server = await started(
    await serve(evmServer(net, { account, amount: "0.10", x402Only: true, ...options })),
  );
  return { url: `${server.origin}/paid`, seller: account.address };
}

function env(wallet: LocalWallet, extra: Record<string, string> = {}) {
  return cliEnv(net, wallet, {
    TEMPO_FUNDING: "auto",
    TEMPO_RELAY_URL: relay.url,
    TEMPO_LAYERZERO_SCAN_URL: stargate.url,
    ...extra,
  });
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
    expect(result.stderr).toMatch(/^Paid 0\.1 USDC · tx 0x[0-9a-f]{64}$/m);
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

  test("waits for the destination balance when the relay reports success before delivering", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    relay.lagDelivery(3_000);

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(result.stderr).toMatch(/^Paid 0\.1 USDC · tx 0x[0-9a-f]{64}$/m);
    expect(relay.deposited).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
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
    "wrong-spender",
    "wrong-order",
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
    // Nothing moved, so nothing is left to recover.
    const list = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(list.stdout)).toMatchObject({ total: 0 });
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

  test("bridges USDC through Stargate when it quotes below Relay, in one Tempo transaction", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.usdc, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    // Relay was quoted too (0.1013), but Stargate's 0.10001 plus 0.001 fee is less.
    expect(relay.quotes).toHaveLength(1);
    expect(relay.deposited).toHaveLength(0);
    expect(result.stderr).toMatch(
      /^Bridging 0\.10001 USDC \(plus 0\.001 LayerZero fee\) to 0x[0-9a-fA-F]{40} on local-evm via Stargate \(tx 0x[0-9a-f]{64}\)$/m,
    );
    expect(stargate.sent).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
    const spent = 1_000_000n - (await tempoBalance(net, net.usdc, wallet.address));
    expect(spent).toBeGreaterThanOrEqual(101_010n);
    expect(spent).toBeLessThan(101_010n + 20_000n);
  });

  test("bridges from OUSD through Relay when the wallet's USDC cannot cover it", async () => {
    const wallet = await localWallet(net, {
      funds: [
        { token: net.usdc, limit: 50_000n },
        { token: net.ousd, limit: 1_000_000n },
      ],
    });
    const endpoint = await x402Endpoint();

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(
      /^Bridging 0\.1013 OUSD to 0x[0-9a-fA-F]{40} on local-evm via Relay/m,
    );
    expect(stargate.sent).toHaveLength(0);
    expect(await tempoBalance(net, net.usdc, wallet.address)).toBe(50_000n);
  });

  test("refuses before quoting when no source token covers the shortfall", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 50_000n }] });
    const endpoint = await x402Endpoint();

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result.code).toBe(4);
    expect(output(result)).toContain("E_INSUFFICIENT_FUNDS");
    expect(output(result)).toContain("0.05 OUSD");
    expect(relay.quotes).toHaveLength(0);
    const list = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(list.stdout)).toMatchObject({ total: 0 });
  });

  test("refuses before signing when the wallet cannot cover any route's quote", async () => {
    // 0.101 USDC passes the rough pre-quote check, but Relay needs 0.1013 and Stargate 0.10101.
    const wallet = await localWallet(net, { funds: [{ token: net.usdc, limit: 101_000n }] });
    const endpoint = await x402Endpoint();

    const result = await runCli("request", [endpoint.url], env(wallet));

    expect(result.code).toBe(4);
    expect(output(result)).toContain("E_INSUFFICIENT_FUNDS");
    expect(output(result)).toContain("needs 0.10101 of the source token");
    expect(output(result)).toContain("holds 0.101; nothing was sent");
    expect(output(result)).not.toContain("Bridging");
    expect(relay.deposited).toHaveLength(0);
    expect(stargate.sent).toHaveLength(0);
    expect(await tempoBalance(net, net.usdc, wallet.address)).toBe(101_000n);
    const list = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(list.stdout)).toMatchObject({ total: 0 });
  });

  test("recovers a Stargate bridge after the CLI is killed, without bridging again", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.usdc, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    stargate.hold(true);

    const first = startCli("request", [endpoint.url], env(wallet));
    await stargate.waitForSends(1);
    first.child.kill("SIGKILL");
    expect((await first.done).signal).toBe("SIGKILL");

    const listed = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    const [operation] = (
      JSON.parse(listed.stdout) as { operations: { id: string; route: string | null }[] }
    ).operations;
    expect(operation).toMatchObject({ route: "stargate" });
    const pending = await runCli(
      "wallet",
      ["funding", "recover", operation!.id, "--format", "json"],
      env(wallet),
    );
    expect(JSON.parse(pending.stdout)).toMatchObject({ id: operation!.id, status: "pending" });
    stargate.hold(false);

    const rerun = await runCli("request", [endpoint.url], env(wallet));

    expect(rerun).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(rerun.stderr).not.toContain("Bridging");
    expect(stargate.sent).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
  });

  test("finds a Stargate send whose hash was never recorded, instead of asking for a human", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.usdc, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint();
    stargate.hold(true);

    const first = startCli("request", [endpoint.url], env(wallet));
    await stargate.waitForSends(1);
    first.child.kill("SIGKILL");
    await first.done;
    // A kill between broadcasting and recording leaves the operation without its hash.
    const operations = join(wallet.home, ".tempo", "wallet", "funding", "operations");
    for (const name of await readdir(operations))
      if (name.endsWith(".reference")) await rm(join(operations, name));

    const listed = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    const [operation] = (JSON.parse(listed.stdout) as { operations: { id: string }[] }).operations;
    const recover = () =>
      runCli("wallet", ["funding", "recover", operation!.id, "--format", "json"], env(wallet));
    expect(JSON.parse((await recover()).stdout)).toMatchObject({ status: "pending" });
    stargate.hold(false);
    await expect
      .poll(async () => JSON.parse((await recover()).stdout).status, { timeout: 20_000 })
      .toBe("completed");

    const rerun = await runCli("request", [endpoint.url], env(wallet));
    expect(rerun).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(stargate.sent).toHaveLength(1);
  });

  test("keeps a delivery the server refused to be paid with for the next request", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const endpoint = await x402Endpoint({ rejectPaid: 1 });

    const refused = await runCli("request", [endpoint.url], env(wallet));
    expect(refused.code).not.toBe(0);
    expect(relay.deposited).toHaveLength(1);
    const payer = relay.intent(relay.deposited[0]!)!.recipient;
    expect(await evmBalance(net, net.evmUsdc, payer)).toBe(100_000n);

    const rerun = await runCli("request", [endpoint.url], env(wallet));
    expect(rerun).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
    });
    expect(rerun.stderr).not.toContain("Bridging");
    expect(relay.deposited).toHaveLength(1);
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);
  });

  test("recovers a bridge whose delivery a killed run already paid with", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    let settled!: () => void;
    const paid = new Promise<void>((resolve) => (settled = resolve));
    const endpoint = await x402Endpoint({
      // Hold the response, so the CLI is killed after paying but before recording it.
      afterSettle: () => (settled(), new Promise(() => {})),
    });

    const first = startCli("request", [endpoint.url], env(wallet));
    await paid;
    first.child.kill("SIGKILL");
    await first.done;
    expect(await evmBalance(net, net.evmUsdc, endpoint.seller)).toBe(100_000n);

    const listed = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    const [operation] = (JSON.parse(listed.stdout) as { operations: { id: string }[] }).operations;
    expect(operation).toBeDefined();
    // The payer's balance is spent, so only the fill transaction shows the delivery.
    const recovered = await runCli(
      "wallet",
      ["funding", "recover", operation!.id, "--format", "json"],
      env(wallet),
    );
    expect(JSON.parse(recovered.stdout)).toMatchObject({ status: "completed" });
    const after = await runCli("wallet", ["funding", "list", "--format", "json"], env(wallet));
    expect(JSON.parse(after.stdout)).toMatchObject({ total: 0 });
  });
});
