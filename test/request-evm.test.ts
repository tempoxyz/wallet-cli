import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

import { Challenge, Credential } from "mppx";
import { Header as X402Header } from "mppx/x402";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  verifyTypedData,
  type Address,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runRequest } from "../src/request/run.js";
import {
  ensureRemotePayer,
  loadRemotePayer,
  remotePayersPath,
} from "../src/wallet/remote-payer.js";
import { useTempHome, walletState, writeWalletState } from "./helpers.js";

const exec = promisify(execFile);

const baseUsdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const tempoUsdc = "0x20c000000000000000000000b9537d11c60e8b50";
const ousd = "0x20c0000000000000000000006a37da5c996874be";
const seller = "0x00000000000000000000000000000000000000a1";
const servers: ReturnType<typeof createServer>[] = [];
/** Balances the stub RPC reports, by lowercase `token:owner`. */
const balances = new Map<string, bigint>();

const transferWithAuthorization = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

beforeEach(async () => {
  await useTempHome();
  await writeWalletState(walletState());
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_FUNDING", "");
  const rpc = await rpcStub();
  vi.stubEnv("TEMPO_RPC_URL", rpc);
  vi.stubEnv("TEMPO_BASE_RPC_URL", rpc);
});

afterEach(async () => {
  vi.unstubAllEnvs();
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

async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}

/** A JSON-RPC stub for Tempo and Base: chain IDs, and `balanceOf` from `balances` (else 0). */
async function rpcStub() {
  return listen(
    createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { id, method, params } = JSON.parse(body) as {
        id: number;
        method: string;
        params: [{ to: string; data: `0x${string}` }];
      };
      let result: string | undefined;
      if (method === "eth_chainId") result = "0x1079";
      else if (method === "eth_call" && params[0].data.startsWith("0x70a08231")) {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
        const owner = String(args?.[0]).toLowerCase();
        result = encodeFunctionResult({
          abi: erc20Abi,
          functionName: "balanceOf",
          result: balances.get(`${params[0].to.toLowerCase()}:${owner}`) ?? 0n,
        });
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          result === undefined
            ? { jsonrpc: "2.0", id, error: { code: -32601, message: "not stubbed" } }
            : { jsonrpc: "2.0", id, result },
        ),
      );
    }),
  );
}

type Accept = Record<string, unknown>;

function x402Accept(overrides: Accept = {}): Accept {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount: "100000",
    asset: baseUsdc,
    payTo: seller,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

function tempoOffer(amount = "100000") {
  return Challenge.serialize(
    Challenge.from({
      id: "tempo",
      realm: "local",
      method: "tempo",
      intent: "charge",
      request: { amount, currency: tempoUsdc, recipient: seller, methodDetails: { chainId: 4217 } },
    }),
  );
}

function evmOffer(overrides: Record<string, unknown> = {}) {
  return Challenge.serialize(
    Challenge.from({
      id: "evm",
      realm: "local",
      method: "evm",
      intent: "charge",
      request: {
        amount: "100000",
        currency: baseUsdc,
        recipient: seller,
        methodDetails: { chainId: 8453, decimals: 6, credentialTypes: ["authorization"] },
        ...overrides,
      },
    }),
  );
}

/** A paid endpoint offering `x402` accepts and `mpp` WWW-Authenticate offers; records credentials. */
async function service(offers: {
  x402?: Accept[];
  x402Version?: number;
  mpp?: string[];
  /** Headers the paid response carries, such as a settlement receipt. */
  settled?: Record<string, string>;
}) {
  const paid: { header: string; value: string }[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    const signature = req.headers["payment-signature"];
    const authorization = req.headers.authorization;
    if (typeof signature === "string" || typeof authorization === "string") {
      paid.push(
        typeof signature === "string"
          ? { header: "payment-signature", value: signature }
          : { header: "authorization", value: authorization as string },
      );
      res.writeHead(200, offers.settled).end("paid");
      return;
    }
    const headers: Record<string, string> = {};
    if (offers.mpp?.length) headers["www-authenticate"] = offers.mpp.join(", ");
    if (offers.x402)
      headers["payment-required"] = Buffer.from(
        JSON.stringify({
          x402Version: offers.x402Version ?? 2,
          resource: { url: `${origin}/` },
          accepts: offers.x402,
        }),
      ).toString("base64");
    res.writeHead(402, headers).end("Payment Required");
  });
  origin = await listen(server);
  return { url: `${origin}/`, paid };
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

async function remotePayerAddress() {
  return (await ensureRemotePayer(walletState().accounts[0]!.address)).address;
}

function fund(token: string, owner: string, amount: bigint) {
  balances.set(`${token.toLowerCase()}:${owner.toLowerCase()}`, amount);
}

describe("EVM offers", () => {
  it("pays an x402 Base USDC charge from a funded remote payer with a verifiable authorization", async () => {
    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 100_000n);
    const endpoint = await service({ x402: [x402Accept()] });

    const meta = join(process.env.HOME!, "meta.json");
    const { stdout, stderr } = await run(["--write-meta", meta], endpoint.url);

    expect(stdout).toBe("paid");
    expect(stderr).toBe("Paid 0.1 USDC\n");
    expect(endpoint.paid).toHaveLength(1);
    expect(endpoint.paid[0]!.header).toBe("payment-signature");
    const payload = X402Header.decodePaymentSignature(endpoint.paid[0]!.value);
    const { authorization, signature } = payload.payload as {
      authorization: Record<string, string>;
      signature: `0x${string}`;
    };
    expect(authorization).toMatchObject({ from: payer, to: getAddress(seller), value: "100000" });
    await expect(
      verifyTypedData({
        address: payer,
        domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: baseUsdc },
        types: transferWithAuthorization,
        primaryType: "TransferWithAuthorization",
        message: {
          from: authorization.from as Address,
          to: authorization.to as Address,
          value: BigInt(authorization.value!),
          validAfter: BigInt(authorization.validAfter!),
          validBefore: BigInt(authorization.validBefore!),
          nonce: authorization.nonce as `0x${string}`,
        },
        signature,
      }),
    ).resolves.toBe(true);
    expect(JSON.parse(await readFile(meta, "utf8")).payment).toMatchObject({
      amount: "0.1",
      token: baseUsdc.toLowerCase(),
      symbol: "USDC",
      payer: payer.toLowerCase(),
      chain_id: 8453,
      network: "base",
    });
  });

  describe("settlement transaction", () => {
    const tx = `0x${"bc".repeat(32)}`;
    const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
    const paidMeta = async (settled: Record<string, string>, offers = { x402: [x402Accept()] }) => {
      const payer = await remotePayerAddress();
      fund(baseUsdc, payer, 100_000n);
      const endpoint = await service({ ...offers, settled });
      const meta = join(process.env.HOME!, "meta.json");
      const { stderr } = await run(["--write-meta", meta], endpoint.url);
      return { stderr, payment: JSON.parse(await readFile(meta, "utf8")).payment };
    };

    it("records the transaction x402's payment-response names", async () => {
      const { stderr, payment } = await paidMeta({
        "payment-response": base64({
          success: true,
          payer: seller,
          transaction: tx,
          network: "eip155:8453",
        }),
      });

      expect(payment.tx_hash).toBe(tx);
      expect(stderr).toBe(`Paid 0.1 USDC · tx ${tx}\n`);
    });

    it.each([
      ["a failed settlement", { success: false, transaction: tx, network: "eip155:8453" }],
      ["another network", { success: true, transaction: tx, network: "eip155:1" }],
      ["a malformed hash", { success: true, transaction: "0x12", network: "eip155:8453" }],
    ])("records no transaction for %s", async (_name, settlement) => {
      const { payment } = await paidMeta({ "payment-response": base64(settlement) });

      expect(payment.tx_hash).toBeNull();
    });

    it("records the transaction an MPP evm receipt names", async () => {
      const receipt = Buffer.from(
        JSON.stringify({ method: "evm", status: "success", reference: tx }),
      ).toString("base64url");
      const { payment } = await paidMeta({ "payment-receipt": receipt }, {
        mpp: [evmOffer()],
      } as never);

      expect(payment.tx_hash).toBe(tx);
    });
  });

  it("pays a native MPP evm charge from the remote payer", async () => {
    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 100_000n);
    const endpoint = await service({ mpp: [evmOffer()] });

    await run([], endpoint.url);

    expect(endpoint.paid).toHaveLength(1);
    expect(endpoint.paid[0]!.header).toBe("authorization");
    const credential = Credential.deserialize<Record<string, string>>(endpoint.paid[0]!.value);
    expect(credential.payload).toMatchObject({
      type: "authorization",
      from: payer,
      value: "100000",
    });
  });

  it("refuses an unfunded remote payer before signing, naming its address", async () => {
    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 40_000n);
    const endpoint = await service({ x402: [x402Accept()] });

    await expect(run([], endpoint.url)).rejects.toMatchObject({
      code: "E_INSUFFICIENT_FUNDS",
      message: `The remote payer ${payer} holds 0.04 USDC on base, below the 0.1 USDC this payment needs. Send USDC on base to ${payer}, then retry, or rerun with --funding auto to bridge it from the Tempo wallet.`,
    });
    expect(endpoint.paid).toEqual([]);
  });

  it("refuses an EVM charge over --max-spend before signing", async () => {
    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 10_000_000n);
    const endpoint = await service({ x402: [x402Accept({ amount: "2000000" })] });

    await expect(run(["--max-spend", "1"], endpoint.url)).rejects.toMatchObject({
      code: "E_LIMIT_EXCEEDED",
    });
    expect(endpoint.paid).toEqual([]);
  });

  it.each([
    { name: "a non-canonical amount", accept: x402Accept({ amount: "0100000" }) },
    { name: "a non-canonical chain ID", accept: x402Accept({ network: "eip155:08453" }) },
    { name: "another chain", accept: x402Accept({ network: "eip155:1" }) },
    {
      name: "another token",
      accept: x402Accept({ asset: "0x0000000000000000000000000000000000000bad" }),
    },
    {
      name: "another EIP-3009 domain",
      accept: x402Accept({ extra: { name: "Evil", version: "2" } }),
    },
    { name: "an unsupported scheme", accept: x402Accept({ scheme: "upto" }) },
  ])("refuses an x402 offer with $name as E_PAYMENT", async ({ accept }) => {
    await remotePayerAddress();
    const endpoint = await service({ x402: [accept] });

    await expect(run([], endpoint.url)).rejects.toMatchObject({ code: "E_PAYMENT" });
    expect(endpoint.paid).toEqual([]);
  });

  it("refuses an x402 v1 challenge as E_PAYMENT", async () => {
    const endpoint = await service({ x402: [x402Accept()], x402Version: 1 });

    await expect(run([], endpoint.url)).rejects.toMatchObject({ code: "E_PAYMENT" });
    expect(endpoint.paid).toEqual([]);
  });
});

describe("offer ranking", () => {
  const dual = () => service({ mpp: [tempoOffer()], x402: [x402Accept()] });
  const quote = async (args: string[] = []) =>
    JSON.parse((await run(["--dry-run", ...args], (await dual()).url)).stdout) as {
      method: string;
      chain_id: number;
    };

  it("prefers a Tempo offer in a held token", async () => {
    fund(tempoUsdc, walletState().accounts[0]!.address, 1_000_000n);
    fund(baseUsdc, await remotePayerAddress(), 1_000_000n);
    expect(await quote()).toMatchObject({ method: "tempo", chain_id: 4217 });
  });

  it("prefers a Tempo offer a DEX swap funds over a funded EVM offer", async () => {
    fund(ousd, walletState().accounts[0]!.address, 1_000_000n);
    fund(baseUsdc, await remotePayerAddress(), 1_000_000n);
    expect(await quote()).toMatchObject({ method: "tempo" });
  });

  it("prefers a funded EVM offer when the Tempo offer cannot be paid", async () => {
    fund(baseUsdc, await remotePayerAddress(), 1_000_000n);
    expect(await quote()).toMatchObject({ method: "x402", chain_id: 8453 });
  });

  it("keeps the Tempo offer when neither can be paid", async () => {
    expect(await quote()).toMatchObject({ method: "tempo" });
  });

  it.each([
    { args: ["--payment-network", "base"], method: "x402" },
    { args: ["--payment-network", "tempo"], method: "tempo" },
  ])("follows $args", async ({ args, method }) => {
    fund(tempoUsdc, walletState().accounts[0]!.address, 1_000_000n);
    expect(await quote(args)).toMatchObject({ method });
  });

  it("ignores EVM offers with --funding off", async () => {
    fund(baseUsdc, await remotePayerAddress(), 1_000_000n);
    expect(await quote(["--funding", "off"])).toMatchObject({ method: "tempo" });
  });

  it("pays the named EVM chain with --funding off and --payment-network, never the Tempo offer", async () => {
    fund(tempoUsdc, walletState().accounts[0]!.address, 1_000_000n);
    expect(await quote(["--funding", "off", "--payment-network", "base"])).toMatchObject({
      method: "x402",
      chain_id: 8453,
    });
  });

  it("names a missing --payment-network offer", async () => {
    await expect(quote(["--payment-network", "arbitrum"])).rejects.toMatchObject({
      code: "E_PAYMENT",
      message: "Server did not offer a payable charge on arbitrum",
    });
  });

  it("quotes an EVM offer without creating a remote payer", async () => {
    const endpoint = await service({ x402: [x402Accept()] });
    const output = JSON.parse((await run(["--dry-run"], endpoint.url)).stdout);
    expect(output).toMatchObject({
      method: "x402",
      raw_amount: "100000",
      raw_deposit: null,
      token: baseUsdc.toLowerCase(),
      balance: "0",
      chain_id: 8453,
      network: "base",
      signer: { address: null },
    });
    expect(await loadRemotePayer(walletState().accounts[0]!.address)).toBeUndefined();
  });
});

describe("remote payer", () => {
  it("is stored readable only by the owner, and its key appears in no output", async () => {
    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 100_000n);
    const endpoint = await service({ x402: [x402Accept()] });
    const file = remotePayersPath();
    const { privateKey } = Object.values(
      (
        JSON.parse(await readFile(file, "utf8")) as {
          payers: Record<string, { privateKey: string }>;
        }
      ).payers,
    )[0]!;

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const outputs: string[] = [];
    for (const args of [[], ["-j"], ["--format", "json"], ["--format", "toon"], ["--dry-run"]]) {
      const result = await run(args, endpoint.url).catch((error: unknown) => ({
        stdout: String(error),
        stderr: JSON.stringify(error),
      }));
      outputs.push(result.stdout, result.stderr);
    }
    const unfunded = await service({ x402: [x402Accept({ amount: "999999999" })] });
    outputs.push(
      String(await run(["--max-spend", "1000"], unfunded.url).catch((error: unknown) => error)),
    );
    for (const output of outputs) {
      expect(output.toLowerCase()).not.toContain(privateKey.slice(2).toLowerCase());
    }
  });

  it("is created once across concurrent processes", async () => {
    const wallet = walletState().accounts[0]!.address;
    const script = `
      import { ensureRemotePayer } from ${JSON.stringify(join(process.cwd(), "src/wallet/remote-payer.ts"))};
      console.log((await ensureRemotePayer(${JSON.stringify(wallet)})).address);
    `;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
          env: { ...process.env },
        }),
      ),
    );
    const addresses = new Set(results.map((result) => result.stdout.trim()));
    expect(addresses.size).toBe(1);
    expect((await loadRemotePayer(wallet))?.address).toBe([...addresses][0]);
  });
});

describe("whoami", () => {
  it("shows the remote payer and its USDC once a payment created it", async () => {
    const { currentWhoamiOutput } = await import("../src/commands/whoami.js");
    const wallet = walletState();
    const options = {
      walletAddress: wallet.accounts[0]!.address,
      chain: 4217,
      accessKeys: wallet.accessKeys,
    };
    expect(await currentWhoamiOutput(options)).not.toHaveProperty("remote_payer");

    const payer = await remotePayerAddress();
    fund(baseUsdc, payer, 250_000n);

    expect((await currentWhoamiOutput(options)).remote_payer).toEqual({
      address: payer.toLowerCase(),
      balances: [
        {
          chain_id: 8453,
          network: "base",
          token: baseUsdc.toLowerCase(),
          symbol: "USDC",
          balance: "0.25",
        },
      ],
    });
  });
});
