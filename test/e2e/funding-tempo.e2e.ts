import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, inject, test } from "vitest";

import { cliEnv, runCli } from "./cli.js";
import { tempoBalance } from "./localnet.js";
import { type LocalServer, mppServer, serve } from "./servers.js";
import { localWallet } from "./wallet.js";

const net = inject("localnet");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function started(server: LocalServer) {
  cleanup.push(() => server.close());
  return server;
}

describe("Tempo DEX funding", () => {
  test("pays an MPP charge in USDC from OUSD through one Tempo DEX swap", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli(
      "request",
      ["--write-meta", `${wallet.home}/meta.json`, `${server.origin}/paid`],
      cliEnv(net, wallet),
    );

    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining("paid on Tempo") });
    expect(result.stderr).toMatch(
      /^Paid 0\.01 0x[0-9a-f]{40} · bought with up to 0\.01005 0x[0-9a-f]{40} on the Tempo DEX/m,
    );
    expect(await tempoBalance(net, net.usdc, recipient)).toBe(10_000n);
    // The swap bought exactly the payment at parity; fees are paid in a touched token.
    expect(await tempoBalance(net, net.usdc, wallet.address)).toBe(0n);
    const spent = 1_000_000n - (await tempoBalance(net, net.ousd, wallet.address));
    expect(spent).toBeGreaterThanOrEqual(10_000n);
    expect(spent).toBeLessThan(20_000n);
  });

  test("refuses the swap before signing when the access key cannot spend OUSD", async () => {
    const wallet = await localWallet(net, {
      funds: [{ token: net.ousd, limit: 1_000_000n }],
      limits: [
        { token: net.usdc, limit: 100_000_000n },
        { token: net.ousd, limit: 1_000n },
        { token: "0x20c0000000000000000000000000000000000000", limit: 1_000_000n },
      ],
    });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain("E_LIMIT_EXCEEDED");
    expect(result.stdout + result.stderr).toContain("tempo wallet keys update");
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
    expect(await tempoBalance(net, net.usdc, recipient)).toBe(0n);
  });

  test("refuses before signing when nothing the wallet holds can buy the charge", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 5_000n }] });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain("E_INSUFFICIENT_FUNDS");
    expect(result.stdout + result.stderr).toContain("tempo wallet fund");
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(5_000n);
    expect(await tempoBalance(net, net.usdc, recipient)).toBe(0n);
  });

  test("refuses a charge above --max-spend before signing, naming the cap it needs", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli(
      "request",
      ["--max-spend", "0.005", `${server.origin}/paid`],
      cliEnv(net, wallet),
    );

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain("E_LIMIT_EXCEEDED");
    expect(result.stdout + result.stderr).toContain("--max-spend 0.01");
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
  });

  test("wallet swap checks the key's remaining limit on chain, not the stored grant", async () => {
    const wallet = await localWallet(net, {
      funds: [{ token: net.ousd, limit: 1_000_000n }],
      limits: [
        { token: net.usdc, limit: 100_000_000n },
        { token: net.ousd, limit: 30_000n },
        { token: "0x20c0000000000000000000000000000000000000", limit: 1_000_000n },
      ],
    });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );
    // Spends about 0.01 OUSD of the key's 0.03 through a DEX swap, and publishes the key.
    const paid = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));
    expect(paid.code).toBe(0);

    // 0.025 fits the stored 0.03, but not what is left of it.
    const swap = await runCli(
      "wallet",
      ["swap", "0.025", net.ousd, net.usdc, "--yes", "--format", "json"],
      cliEnv(net, wallet),
    );

    expect(swap.code).toBe(4);
    expect(swap.stdout + swap.stderr).toMatch(
      /The access key has 0\.00995 OUSD left of its spending limit, short of the 0\.05 OUSD a DEX swap needs/,
    );
    expect(swap.stdout + swap.stderr).toContain("tempo wallet keys update");
  });

  test("refuses before signing when the key's limit covers a DEX swap's input only once", async () => {
    // The approve and the DEX's pull both count: 0.015 OUSD covers 0.01005 once, and the swap
    // would revert in simulation.
    const wallet = await localWallet(net, {
      funds: [{ token: net.ousd, limit: 1_000_000n }],
      limits: [
        { token: net.usdc, limit: 100_000_000n },
        { token: net.ousd, limit: 15_000n },
        { token: "0x20c0000000000000000000000000000000000000", limit: 1_000_000n },
      ],
    });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain("E_LIMIT_EXCEEDED");
    expect(result.stdout + result.stderr).toContain("--limit 0.0201");
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
  });

  test("refuses a charge in a token the CLI does not list, which no cap can bound", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const unlisted = "0x20c000000000000000000000000000000000dead";
    const server = await started(
      await serve(mppServer(net, { currency: unlisted, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain("E_LIMIT_EXCEEDED");
    expect(await tempoBalance(net, net.ousd, wallet.address)).toBe(1_000_000n);
  });

  test("refuses to pay with an expired access key, naming the refresh", async () => {
    const wallet = await localWallet(net, {
      funds: [{ token: net.usdc, limit: 1_000_000n }],
      expiry: Math.floor(Date.now() / 1000) - 60,
    });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toMatch(/E_KEY_EXPIRED|E_AUTH_REFRESH_REQUIRED/);
    expect(result.stdout + result.stderr).toContain("tempo wallet refresh");
    expect(await tempoBalance(net, net.usdc, recipient)).toBe(0n);
  });
});
