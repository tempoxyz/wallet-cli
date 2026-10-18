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
});
