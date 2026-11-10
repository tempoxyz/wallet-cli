import { Mppx, evm } from "mppx/client";
import { Assets } from "mppx/evm";
import { erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Actions, Addresses } from "viem/tempo";
import { afterEach, describe, expect, inject, test } from "vitest";

import { cliEnv, runCli } from "./cli.js";
import { evmBalance, evmClient, tempoBalance, tempoClient } from "./localnet.js";
import { standInRelay } from "./relay.js";
import { evmServer, type LocalServer, mppServer, serve } from "./servers.js";
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

describe("local harness", () => {
  test("tempo request pays an MPP charge on the local Tempo chain in a held token", async () => {
    const wallet = await localWallet(net, {
      funds: [
        { token: net.ousd, limit: 1_000_000n },
        { token: net.usdc, limit: 1_000_000n },
      ],
    });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const server = await started(
      await serve(mppServer(net, { currency: net.usdc, recipient, amount: "0.01" })),
    );

    const result = await runCli("request", [`${server.origin}/paid`], cliEnv(net, wallet));

    expect(result).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("paid on Tempo"),
      stderr: expect.stringContaining("Paid 0.01"),
    });
    expect(await tempoBalance(net, net.usdc, recipient)).toBe(10_000n);
    // The payment's transaction pays its fee in the token it transfers.
    const left = await tempoBalance(net, net.usdc, wallet.address);
    expect(left).toBeLessThan(990_000n);
    expect(left).toBeGreaterThan(980_000n);
  });

  test("the stand-in relay releases USDC for an OUSD deposit through Relay's HTTP API", async () => {
    const relay = await standInRelay(net);
    cleanup.push(() => relay.close());
    const sender = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    await Actions.token.mintSync(tempoClient(net), {
      token: net.ousd,
      to: sender.address,
      amount: 1_000_000n,
      feeToken: Addresses.pathUsd,
    });

    const quote = (await (
      await fetch(`${relay.url}/quote/v2`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: "100000",
          originChainId: net.tempoChainId,
          originCurrency: net.ousd,
          destinationChainId: net.evmChainId,
          destinationCurrency: net.evmUsdc,
          recipient,
          user: sender.address,
          tradeType: "EXACT_OUTPUT",
          useDepositAddress: true,
        }),
      })
    ).json()) as {
      details: { currencyIn: { amount: string } };
      steps: {
        requestId: `0x${string}`;
        depositAddress: `0x${string}`;
        items: { data: { to: `0x${string}`; data: `0x${string}` } }[];
      }[];
    };
    const [step] = quote.steps;
    expect(quote.details.currencyIn.amount).toBe("101300");
    await Actions.token.transferSync(tempoClient(net, sender), {
      token: net.ousd,
      to: step!.depositAddress,
      amount: 101_300n,
      feeToken: net.ousd,
    });
    let status = "waiting";
    while (status !== "success") {
      status = (
        (await (
          await fetch(`${relay.url}/intents/status/v3?requestId=${step!.requestId}`)
        ).json()) as {
          status: string;
        }
      ).status;
      expect(["waiting", "pending", "success"]).toContain(status);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await evmBalance(net, net.evmUsdc, recipient)).toBe(100_000n);
  });

  test("the local x402 server settles an EIP-3009 authorization on the EVM chain", async () => {
    const seller = privateKeyToAccount(generatePrivateKey());
    const payer = privateKeyToAccount(generatePrivateKey());
    const chain = evmClient(net);
    await chain.waitForTransactionReceipt({
      hash: await chain.sendTransaction({ to: seller.address, value: 10n ** 18n }),
    });
    await chain.waitForTransactionReceipt({
      hash: await chain.writeContract({
        address: net.evmUsdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [payer.address, 1_000_000n],
      }),
    });
    const server = await started(
      await serve(evmServer(net, { account: seller, amount: "0.10", x402Only: true })),
    );
    const challenge = await fetch(`${server.origin}/paid`);
    expect(challenge.status).toBe(402);
    expect(challenge.headers.has("payment-required")).toBe(true);
    expect(challenge.headers.has("www-authenticate")).toBe(false);

    const client = Mppx.create({
      methods: [
        evm.charge({
          account: payer,
          networks: [net.evmChainId],
          currencies: [
            Assets.define({
              address: net.evmUsdc,
              decimals: 6,
              network: `eip155:${net.evmChainId}`,
              transfer: { type: "eip3009", name: "USDC", version: "2" },
            }),
          ],
        }),
      ],
      polyfill: false,
    });
    const response = await client.fetch(`${server.origin}/paid`);

    expect(response.status).toBe(200);
    expect(await evmBalance(net, net.evmUsdc, seller.address)).toBe(100_000n);
  });
});
