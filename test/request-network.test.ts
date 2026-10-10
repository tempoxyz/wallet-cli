import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { Challenge, Credential } from "mppx";
import { Mppx, session } from "mppx/client";
import { Session } from "mppx/tempo";
import { prepareTransactionRequest, signTransaction } from "viem/actions";
import { Account } from "viem/tempo";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  parseRequestArgs,
  preparePaymentChallenge,
  resolvePaymentIdentity,
  runRequest,
} from "../src/commands/request.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import {
  testPrivateKey,
  testPrivateKey2,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

vi.mock("viem/actions", async (original) => ({
  ...(await original<typeof import("viem/actions")>()),
  prepareTransactionRequest: vi.fn(async (_client, parameters) => ({
    ...parameters,
    gas: 10_000n,
  })),
  signTransaction: vi.fn(async () => "0x021234"),
}));
vi.mock("viem/tempo", async (original) => {
  const actual = await original<typeof import("viem/tempo")>();
  return {
    ...actual,
    Account: { ...actual.Account, signVoucher: vi.fn(async () => `0x${"1".repeat(128)}1b`) },
    Actions: {
      ...actual.Actions,
      token: {
        ...actual.Actions.token,
        getBalance: Object.assign(
          vi.fn().mockResolvedValue({ amount: 1_000_000n }),
          actual.Actions.token.getBalance,
        ),
      },
    },
  };
});

const servers: ReturnType<typeof createServer>[] = [];
beforeEach(() => {
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.stubEnv("TEMPO_RPC_URL", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external request");
    }),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

async function service(challenges: Challenge.Challenge[]) {
  const paid: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers.authorization) {
      paid.push(request.headers.authorization);
      response.end("paid");
    } else {
      response.writeHead(402, {
        "www-authenticate": challenges.map(Challenge.serialize).join(", "),
      });
      response.end("payment required");
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return { url: `http://127.0.0.1:${address.port}`, paid };
}

async function configureWallet() {
  await useTempHome();
  const testnetKey = Account.fromSecp256k1(testPrivateKey2, { access: testWallet });
  await writeWalletState(
    walletState({
      accessKeys: [
        walletState().accessKeys[0]!,
        {
          ...walletState().accessKeys[0]!,
          address: testnetKey.accessKeyAddress,
          chainId: 42431,
          privateKey: testPrivateKey2,
          limits: [{ token: moderatoToken, limit: "100000000#__bigint" }],
        },
      ],
    }),
  );
  return testnetKey.accessKeyAddress;
}

function offer(chainId: number, intent: "charge" | "session" = "charge") {
  return Challenge.from({
    id: `${chainId}-${intent}`,
    realm: "local",
    method: "tempo",
    intent,
    request: {
      amount: "1000",
      currency: chainId === 42431 ? moderatoToken : usdcToken,
      recipient: testWallet,
      methodDetails: { chainId, ...(intent === "session" ? { sessionProtocol: "v2" } : {}) },
    },
  });
}

it.each([
  { network: "testnet", chain: 42431, otherChain: 4217 },
  { network: "mainnet", chain: 4217, otherChain: 42431 },
])("selects $network offers before choosing a payment intent", (scenario) => {
  const options = parseRequestArgs(["-n", scenario.network, "https://example.com"]);
  for (const intent of ["charge", "session"] as const) {
    const expected = offer(scenario.chain, intent);
    const challenges = [
      offer(scenario.otherChain, "session"),
      offer(scenario.otherChain),
      expected,
    ];
    const response = new Response(null, {
      status: 402,
      headers: { "www-authenticate": challenges.map(Challenge.serialize).join(", ") },
    });
    for (const paymentIntent of ["auto", intent] as const) {
      const selected = preparePaymentChallenge(
        response,
        { ...options, paymentIntent },
        options.url,
      );
      expect(selected.challenge).toEqual(expected);
      expect(Challenge.deserializeList(selected.response.headers.get("www-authenticate")!)).toEqual(
        [expected],
      );
    }
  }
});

it("rejects a mainnet-only offer when testnet is selected", () => {
  const options = parseRequestArgs(["-n", "testnet", "https://example.com"]);
  const response = new Response(null, {
    status: 402,
    headers: { "www-authenticate": Challenge.serialize(offer(4217)) },
  });
  expect(() => preparePaymentChallenge(response, options, options.url)).toThrow(
    "Payment network mismatch: expected chain 42431, received 4217",
  );
});

it("rejects a wrong-network charge before signing or sending a credential", async () => {
  await configureWallet();
  const endpoint = await service([offer(4217)]);
  await expect(
    runRequest(["-n", "testnet", "--payment-intent", "charge", endpoint.url]),
  ).rejects.toMatchObject({ code: "E_PAYMENT" });
  expect(prepareTransactionRequest).not.toHaveBeenCalled();
  expect(signTransaction).not.toHaveBeenCalled();
  expect(endpoint.paid).toEqual([]);
});

it.each(["-n", "--network", "--network=testnet"])(
  "wires %s through the actual request CLI",
  async (flag) => {
    await useTempHome();
    const expected = offer(42431);
    const endpoint = await service([offer(4217), expected]);
    const flags = flag.includes("=") ? [flag] : [flag, "testnet"];
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/request-cli.ts",
          ...flags,
          "--dry-run",
          "--payment-intent",
          "charge",
          endpoint.url,
        ],
        { env: process.env, timeout: 30_000 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`${error.message}: ${stderr}`));
          else resolve(stdout);
        },
      );
    });
    expect(JSON.parse(output)).toMatchObject({
      payment_required: true,
      chain_id: 42431,
      token: moderatoToken,
    });
    expect(endpoint.paid).toEqual([]);
  },
  30_000,
);

it.each([
  { network: "testnet", chain: 42431, rpc: "https://rpc.moderato.tempo.xyz" },
  { network: "mainnet", chain: 4217, rpc: "https://rpc.mainnet.tempo.xyz" },
])("signs SDK charges on $network using the matching stored key and RPC", async (scenario) => {
  const testnetSigner = await configureWallet();
  const expected = offer(scenario.chain);
  const endpoint = await service([offer(scenario.chain === 4217 ? 42431 : 4217), expected]);
  await runRequest(["-n", scenario.network, "--payment-intent", "charge", endpoint.url], {
    stdout: { write: () => true },
  });
  expect(endpoint.paid).toHaveLength(1);
  expect(Credential.deserialize(endpoint.paid[0]!).challenge).toEqual(expected);
  const client = vi.mocked(prepareTransactionRequest).mock.calls[0]![0];
  expect(client.chain?.id).toBe(scenario.chain);
  expect(client.transport.url).toBe(scenario.rpc);
  expect(client.account).toMatchObject({
    accessKeyAddress:
      scenario.chain === 42431 ? testnetSigner : walletState().accessKeys[0]!.address,
  });
  expect(signTransaction).toHaveBeenCalledOnce();
});

it.each(["stored", "ephemeral"])(
  "pins chainless SDK charges to testnet with a %s key",
  async (kind) => {
    await configureWallet();
    if (kind === "ephemeral") vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey);
    const challenge = Challenge.from({
      ...offer(42431),
      request: { ...offer(42431).request, methodDetails: {} },
    });
    const endpoint = await service([challenge]);
    await runRequest(["-n", "testnet", "--payment-intent", "charge", endpoint.url], {
      stdout: { write: () => true },
    });
    expect(vi.mocked(prepareTransactionRequest).mock.calls[0]![0].chain?.id).toBe(42431);
    expect(endpoint.paid).toHaveLength(1);
  },
);

it.each([true, false])(
  "pins SDK session vouchers to testnet (explicit challenge chain: %s)",
  async (explicitChain) => {
    const signer = await configureWallet();
    const options = parseRequestArgs(["-n", "testnet", "https://example.com"]);
    const identity = await resolvePaymentIdentity(options);
    if (!("account" in identity)) throw new Error("Expected stored access-key identity");
    const getClient = vi.fn(identity.getClient);
    const challenge = Challenge.from({
      ...offer(42431, "session"),
      request: {
        ...offer(42431, "session").request,
        methodDetails: { sessionProtocol: "v2", ...(explicitChain ? { chainId: 42431 } : {}) },
      },
    });
    const descriptor = {
      authorizedSigner: signer,
      expiringNonceHash: `0x${"3".repeat(64)}` as `0x${string}`,
      operator: "0x0000000000000000000000000000000000000000" as const,
      payee: testWallet,
      payer: testWallet,
      salt: `0x${"4".repeat(64)}` as `0x${string}`,
      token: moderatoToken,
    } as const;
    const channelId = Session.Precompile.Channel.computeId({ ...descriptor, chainId: 42431 });
    const payment = Mppx.create({
      methods: [session({ ...identity.methodOptions, getClient })],
      polyfill: false,
    });
    const credential = await payment.createCredential(
      new Response(null, {
        status: 402,
        headers: { "www-authenticate": Challenge.serialize(challenge) },
      }),
      {
        action: "voucher",
        channelId,
        descriptor,
        cumulativeAmountRaw: "1000",
      },
    );
    expect(Credential.deserialize(credential)).toMatchObject({
      source: `did:pkh:eip155:42431:${testWallet}`,
      payload: { action: "voucher", channelId },
    });
    expect(Account.signVoucher).toHaveBeenCalledWith(
      identity.account,
      expect.objectContaining({ chainId: 42431, channel: channelId }),
    );
    const client = await getClient.mock.results[0]!.value;
    expect(client.chain?.id).toBe(42431);
    expect(client.transport.url).toBe("https://rpc.moderato.tempo.xyz");
  },
);

it.each([
  { network: "testnet", storedChain: 4217, env: "mainnet" },
  { network: "mainnet", storedChain: 42431, env: "testnet" },
])("includes the selected $network in access-key refresh guidance", async (scenario) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", scenario.env);
  await writeWalletState(
    walletState({
      chainId: scenario.storedChain,
      accessKeys: [{ ...walletState().accessKeys[0]!, chainId: scenario.storedChain }],
    }),
  );
  await expect(
    resolvePaymentIdentity(parseRequestArgs(["-n", scenario.network, "https://example.com"])),
  ).rejects.toMatchObject({
    code: "E_AUTH_REFRESH_REQUIRED",
    message: `No usable access key is configured. Run 'tempo wallet refresh --network ${scenario.network}' before retrying.`,
  });
});
