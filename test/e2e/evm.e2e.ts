import { erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, inject, test } from "vitest";

import { cliEnv, runCli } from "./cli.js";
import { evmBalance, evmClient } from "./localnet.js";
import { evmServer, type LocalServer, serve } from "./servers.js";
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

/** A seller on the local EVM chain with gas to settle authorizations itself. */
async function seller() {
  const account = privateKeyToAccount(generatePrivateKey());
  const chain = evmClient(net);
  await chain.waitForTransactionReceipt({
    hash: await chain.sendTransaction({ to: account.address, value: 10n ** 18n }),
  });
  return account;
}

describe("EVM offers", () => {
  test("pays an x402 charge on the local EVM chain from the remote payer", async () => {
    const wallet = await localWallet(net, { funds: [{ token: net.ousd, limit: 1_000_000n }] });
    const account = await seller();
    const server = await started(
      await serve(evmServer(net, { account, amount: "0.10", x402Only: true })),
    );
    const env = cliEnv(net, wallet, { TEMPO_FUNDING: "tempo" });

    // The first attempt creates the remote payer and names it, since it holds no USDC.
    const unfunded = await runCli("request", [`${server.origin}/paid`], env);
    expect(unfunded.code).toBe(4);
    const payer = /remote payer (0x[0-9a-fA-F]{40}) holds 0 USDC on local-evm/.exec(
      unfunded.stdout + unfunded.stderr,
    )?.[1] as `0x${string}` | undefined;
    expect(payer).toBeDefined();

    const chain = evmClient(net);
    await chain.waitForTransactionReceipt({
      hash: await chain.writeContract({
        address: net.evmUsdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [payer!, 100_000n],
      }),
    });
    const paid = await runCli("request", [`${server.origin}/paid`], env);

    expect(paid).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on the EVM chain"),
      stderr: "Paid 0.1 USDC\n",
    });
    expect(await evmBalance(net, net.evmUsdc, account.address)).toBe(100_000n);
    expect(await evmBalance(net, net.evmUsdc, payer!)).toBe(0n);
  });
});
