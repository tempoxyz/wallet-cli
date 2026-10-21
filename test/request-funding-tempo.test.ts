import { createServer } from "node:http";

import { Challenge, Credential } from "mppx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CtaError } from "../src/cli/incur-compat.js";
import { runRequest } from "../src/request/run.js";
import { ousdToken, testAccessKey, useTempHome, walletState, writeWalletState } from "./helpers.js";

const { credentialContexts, balances } = vi.hoisted(() => ({
  credentialContexts: [] as unknown[],
  balances: new Map<string, bigint>(),
}));

// Signing is replaced so a test sees the credential context funding prepared, if any.
vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: () => ({
        onChallengeReceived: () => undefined,
        createCredential: async (response: Response, context?: unknown) => {
          credentialContexts.push(context);
          return Credential.serialize({
            challenge: Challenge.fromResponseList(response)[0]!,
            payload: { type: "hash", hash: `0x${"ab".repeat(32)}` },
          });
        },
        transport: {
          setCredential: (init: RequestInit, credential: string) => {
            const headers = new Headers(init.headers);
            headers.set("authorization", credential);
            return { ...init, headers };
          },
        },
      }),
    },
  };
});

// Balances come from `balances`, by lowercase token address; an unset one fails to read.
vi.mock("../src/shared/network.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/network.js")>();
  return {
    ...actual,
    createTempoPublicClient: () => ({
      readContract: async ({ address }: { address: string }) => {
        const balance = balances.get(address.toLowerCase());
        if (balance === undefined) throw new Error("balance unavailable");
        return balance;
      },
    }),
  };
});

const usdcE = "0x20c000000000000000000000b9537d11c60e8b50";
const pathUsd = "0x20c0000000000000000000000000000000000000";
const eurc = "0x20c0000000000000000000001621e21f71cf12fb";
const ousd = ousdToken;
const servers: ReturnType<typeof createServer>[] = [];

beforeEach(async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_FUNDING", "");
  vi.stubEnv("TEMPO_RPC_URL", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  credentialContexts.length = 0;
  balances.clear();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A 402 service charging `amount` of `currency` on mainnet; `paid` counts paid requests. */
async function service(currency: string, amount = "10000") {
  const header = Challenge.serialize(
    Challenge.from({
      id: "funding",
      realm: "local",
      method: "tempo",
      intent: "charge",
      request: {
        amount,
        currency,
        recipient: "0x0000000000000000000000000000000000000001",
        methodDetails: { chainId: 4217 },
      },
    }),
  );
  let paid = 0;
  const server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(402, { "www-authenticate": header }).end("Payment Required");
      return;
    }
    paid++;
    res.writeHead(200).end("paid");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { url: `http://127.0.0.1:${address.port}/`, paid: () => paid };
}

async function run(args: string[], url: string) {
  let stdout = "";
  let stderr = "";
  await runRequest([...args, url], {
    stdout: { write: ((chunk: string) => ((stdout += chunk), true)) as never },
    stderr: { write: ((chunk: string) => ((stderr += chunk), true)) as never },
  });
  return { stdout, stderr };
}

const wallet = (
  limits: { token: string; limit: string }[] = [
    { token: ousd, limit: "100000000#__bigint" },
    { token: usdcE, limit: "100000000#__bigint" },
  ],
) => {
  const state = walletState();
  return writeWalletState({ ...state, accessKeys: [{ ...state.accessKeys[0]!, limits }] });
};

describe("Tempo DEX funding", () => {
  it.each([
    { name: "the default slippage", args: [], slippage: 0.5 },
    { name: "--max-slippage-bps", args: ["--max-slippage-bps", "120"], slippage: 1.2 },
  ])(
    "buys USDC.e from OUSD with $name when the wallet holds only OUSD",
    async ({ args, slippage }) => {
      await wallet();
      balances.set(usdcE, 0n).set(ousd, 5_000_000n).set(pathUsd, 0n);
      const paid = await service(usdcE);

      await run(args, paid.url);

      expect(paid.paid()).toBe(1);
      expect(credentialContexts).toHaveLength(1);
      const [context] = credentialContexts as {
        autoSwap: { tokenIn: string[]; slippage: number };
      }[];
      // Only the chosen input, so Mppx cannot swap from another token the key may not spend.
      expect(context!.autoSwap.tokenIn.map((token) => token.toLowerCase())).toEqual([ousd]);
      expect(context!.autoSwap.slippage).toBe(slippage);
      // Only the configured inputs: Mppx appends no fallback tokens.
      expect(context!.autoSwap).toMatchObject({ fallback: false });
    },
  );

  it("refuses before signing, naming pathUSD, when the key can spend no held input", async () => {
    // The key lists OUSD and USDC.e only; the wallet holds only pathUSD, which it may not spend.
    await wallet();
    balances.set(usdcE, 0n).set(ousd, 0n).set(pathUsd, 5_000_000n);
    const paid = await service(usdcE);

    await expect(run([], paid.url)).rejects.toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining("short of the 0.0201 pathUSD a DEX swap needs"),
    });
    expect(paid.paid()).toBe(0);
    expect(credentialContexts).toEqual([]);
  });

  it("skips an input the key may not spend for the next one it may", async () => {
    // OUSD is held but unlisted for this key; pathUSD is listed.
    await wallet([
      { token: usdcE, limit: "100000000#__bigint" },
      { token: pathUsd, limit: "100000000#__bigint" },
    ]);
    balances.set(usdcE, 0n).set(ousd, 5_000_000n).set(pathUsd, 5_000_000n);
    const paid = await service(usdcE);

    await run([], paid.url);

    expect(paid.paid()).toBe(1);
    const [context] = credentialContexts as { autoSwap: { tokenIn: string[] } }[];
    expect(context!.autoSwap.tokenIn.map((token) => token.toLowerCase())).toEqual([pathUsd]);
  });

  it("pays from a held token without a swap", async () => {
    await wallet();
    balances.set(usdcE, 10_000n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    await run([], paid.url);

    expect(paid.paid()).toBe(1);
    // No swap, stated explicitly so a method-level auto-swap cannot apply either.
    expect(credentialContexts).toEqual([{ autoSwap: false }]);
  });

  it.each([
    { name: "--funding off", args: ["--funding", "off"], env: {} },
    { name: "TEMPO_FUNDING=off", args: [], env: { TEMPO_FUNDING: "off" } },
    { name: "an unreadable balance", args: [], env: {}, unreadable: true },
  ])("pays without funding with $name", async ({ args, env, unreadable }) => {
    await wallet();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    if (!unreadable) balances.set(usdcE, 0n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    await run(args, paid.url);

    // No swap, stated explicitly so a method-level auto-swap cannot apply either.
    expect(credentialContexts).toEqual([{ autoSwap: false }]);
  });

  it("refuses a non-USD token before signing instead of swapping into it", async () => {
    await wallet();
    balances.set(eurc, 0n).set(ousd, 5_000_000n);
    const paid = await service(eurc);

    await expect(run([], paid.url)).rejects.toMatchObject({ code: "E_LIMIT_EXCEEDED" });
    expect(credentialContexts).toEqual([]);
    expect(paid.paid()).toBe(0);
  });

  it("names the keys update when the access key cannot spend the swap input", async () => {
    await wallet([
      { token: usdcE, limit: "100000000#__bigint" },
      { token: ousd, limit: "1000#__bigint" },
    ]);
    balances.set(usdcE, 0n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    const error = await run([], paid.url).catch((value: unknown) => value);

    const command = `tempo wallet keys update ${testAccessKey} --token ${ousd} --limit 0.0201 --network mainnet`;
    expect(error).toBeInstanceOf(CtaError);
    expect(error).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: `The access key has 0.001 OUSD left of its spending limit, short of the 0.0201 OUSD a DEX swap needs (its approve and the DEX's pull each count), so nothing was sent. Ask the wallet owner to run '${command}', then retry.`,
      payload: { cta: { commands: [{ command }] } },
    });
    expect(credentialContexts).toEqual([]);
  });

  it("counts a DEX swap twice against the key: a limit covering the input once is refused", async () => {
    // 0.015 covers the 0.01005 input once, but the approve and the DEX's pull both count.
    await wallet([
      { token: usdcE, limit: "100000000#__bigint" },
      { token: ousd, limit: "15000#__bigint" },
    ]);
    balances.set(usdcE, 0n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    await expect(run([], paid.url)).rejects.toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining(
        "The access key has 0.015 OUSD left of its spending limit, short of the 0.0201 OUSD a DEX swap needs",
      ),
    });
    expect(credentialContexts).toEqual([]);
  });

  it("names the fund command when nothing the wallet holds can buy the token", async () => {
    await wallet();
    balances.set(usdcE, 0n).set(ousd, 1n).set(pathUsd, 0n);
    const paid = await service(usdcE);

    const error = await run([], paid.url).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(CtaError);
    expect(error).toMatchObject({
      code: "E_INSUFFICIENT_FUNDS",
      payload: { cta: { commands: [{ command: "tempo wallet fund --network mainnet" }] } },
    });
    expect(credentialContexts).toEqual([]);
  });

  it("reports the funder in a dry run without signing", async () => {
    await wallet();
    balances.set(usdcE, 0n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    const { stdout } = await run(["--dry-run"], paid.url);

    expect(JSON.parse(stdout)).toMatchObject({
      payment_required: true,
      balance: "0",
      funding: { route: "tempo-dex", inputs: [ousd, usdcE, pathUsd] },
    });
    expect(credentialContexts).toEqual([]);
    expect(paid.paid()).toBe(0);
  });

  it("leaves funding out of a dry run that the balance covers", async () => {
    await wallet();
    balances.set(usdcE, 10_000n);
    const paid = await service(usdcE);

    const { stdout } = await run(["--dry-run"], paid.url);

    expect(JSON.parse(stdout)).not.toHaveProperty("funding");
  });

  it("refuses an invalid --max-slippage-bps", async () => {
    await wallet();
    balances.set(usdcE, 0n).set(ousd, 5_000_000n);
    const paid = await service(usdcE);

    await expect(run(["--max-slippage-bps", "10001"], paid.url)).rejects.toMatchObject({
      code: "E_USAGE",
      message: "--max-slippage-bps must be an integer from 0 to 10000",
    });
  });
});
