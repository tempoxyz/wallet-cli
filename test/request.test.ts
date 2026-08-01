import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Challenge, Credential, Method, z } from "mppx";
import { Mppx, session as tempoSession } from "mppx/client";
import { Keystore } from "accounts";
import { createClient, custom, decodeFunctionData } from "viem";
import { Abis as TempoAbis, Channel as TempoChannel, KeyAuthorizationManager } from "viem/tempo";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildTopUpTransactionRequest,
  isSessionInvalidationResponse,
  parseRequestArgs,
  resolvePaymentIdentity,
  resolveSessionPaymentIdentity,
  runRequest,
  storedAccessKeyIdentity,
  tempoPaymentChallengeResponse,
} from "../src/commands/request.js";
import {
  findReusableSession,
  preserveSessionCumulative,
  readSessionRecordsByOrigin,
  updateSessionReceipt,
  upsertSessionRecord,
} from "../src/payment/session-store.js";
import { withSessionLock } from "../src/payment/session-lock.js";
import {
  testAccessKey,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";
import { loadWalletState } from "../src/wallet/store.js";

type SeenRequest = {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
};

const servers: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("request command", () => {
  it("performs a non-payment GET request", async () => {
    const server = await testServer((_request, response) => {
      response.end("hello world");
    });
    const stdout = captureStdout();

    await runRequest([server.url("/test")], { stdout });

    expect(stdout.text()).toBe("hello world");
  });

  it("posts JSON with the expected method and content type", async () => {
    let seen: SeenRequest | undefined;
    const server = await testServer(async (request, response) => {
      seen = await readSeenRequest(request);
      response.end(JSON.stringify({ ok: true }));
    });
    const stdout = captureStdout();

    await runRequest(["-X", "POST", "--json", '{"key":"value"}', server.url("/api")], { stdout });

    expect(stdout.text()).toBe('{"ok":true}');
    expect(seen?.method).toBe("POST");
    expect(seen?.headers["content-type"]).toContain("application/json");
    expect(seen?.body).toBe('{"key":"value"}');
  });

  it("includes headers in stdout when requested", async () => {
    const server = await testServer((_request, response) => {
      response.setHeader("x-test", "foo");
      response.end("body");
    });
    const stdout = captureStdout();

    await runRequest(["-i", server.url("/headers")], { stdout });

    expect(stdout.text()).toContain("HTTP 200");
    expect(stdout.text()).toContain("x-test: foo");
    expect(stdout.text()).toContain("body");
  });

  it("writes output and dumped headers to files", async () => {
    const home = await useTempHome();
    const outputPath = join(home, "out.txt");
    const headersPath = join(home, "headers.txt");
    const server = await testServer((_request, response) => {
      response.setHeader("x-file", "yes");
      response.end("file body");
    });
    const stdout = captureStdout();

    await runRequest(["-D", headersPath, "-o", outputPath, server.url("/file")], { stdout });

    expect(stdout.text()).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("file body");
    expect(await readFile(headersPath, "utf8")).toContain("x-file: yes");
  });

  it("appends data to the query string with -G", async () => {
    let seen: SeenRequest | undefined;
    const server = await testServer(async (request, response) => {
      seen = await readSeenRequest(request);
      response.end("ok");
    });

    await runRequest(["-G", "-d", "q=hello world", server.url("/search")], {
      stdout: captureStdout(),
    });

    expect(seen?.method).toBe("GET");
    expect(seen?.url).toContain("q=hello%20world");
    expect(seen?.body).toBe("");
  });

  it("uses curl-parity default retry statuses when --retries is set", async () => {
    let calls = 0;
    const server = await testServer((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.statusCode = 500;
        response.end("try again");
        return;
      }
      response.end("ok");
    });
    const stdout = captureStdout();

    await runRequest(["--retries", "1", "--retry-backoff", "0", server.url("/flaky")], { stdout });

    expect(calls).toBe(2);
    expect(stdout.text()).toBe("ok");
  });

  it("does not follow redirects unless -L is provided", async () => {
    const server = await testServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "/target");
      response.end("redirect");
    });
    const stdout = captureStdout();

    await runRequest([server.url("/redirect")], { stdout });

    expect(stdout.text()).toBe("redirect");
  });

  it("follows redirects with the Rust-compatible default and explicit limit", async () => {
    let calls = 0;
    const server = await testServer((request, response) => {
      calls += 1;
      if (request.url === "/redirect") {
        response.statusCode = 302;
        response.setHeader("location", "/target");
        response.end("redirect");
        return;
      }
      response.end("target");
    });
    const stdout = captureStdout();

    await runRequest(["-L", "--max-redirs", "1", server.url("/redirect")], { stdout });

    expect(calls).toBe(2);
    expect(stdout.text()).toBe("target");
  });

  it("fails when the redirect limit is exceeded", async () => {
    const server = await testServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "/again");
      response.end("redirect");
    });

    await expect(
      runRequest(["-L", "--max-redirs", "0", server.url("/redirect")], {
        stdout: captureStdout(),
      }),
    ).rejects.toMatchObject({ code: "E_NETWORK" });
  });

  it("outputs SSE data as Rust-compatible NDJSON records", async () => {
    const server = await testServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.end('data: {"msg":"hello"}\n\nevent: payment-receipt\ndata: {"ok":true}\n\n');
    });
    const stdout = captureStdout();

    await runRequest(["--sse-json", server.url("/stream")], { stdout });

    const lines = stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: "data", data: { msg: "hello" } });
    expect(lines[1]).toMatchObject({ event: "payment-receipt", data: { ok: true } });
    expect(lines[0]?.ts).toEqual(expect.any(String));
  });

  it("emits an SSE error record for --sse-json HTTP failures", async () => {
    const server = await testServer((_request, response) => {
      response.statusCode = 500;
      response.setHeader("content-type", "text/event-stream");
      response.end("broken");
    });
    const stdout = captureStdout();

    await expect(
      runRequest(["--sse-json", server.url("/stream")], { stdout }),
    ).rejects.toMatchObject({ code: "E_NETWORK" });

    const line = JSON.parse(stdout.text().trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "error" });
    expect(String(line.message)).toContain("500");
  });

  it("sends multipart file fields with filename and content type", async () => {
    const home = await useTempHome();
    const filePath = join(home, "upload.txt");
    await writeFile(filePath, "file-content");
    let seen: SeenRequest | undefined;
    const server = await testServer(async (request, response) => {
      seen = await readSeenRequest(request);
      response.end("uploaded");
    });

    await runRequest(["-F", `upload=@${filePath};type=text/plain`, server.url("/upload")], {
      stdout: captureStdout(),
    });

    expect(seen?.headers["content-type"]).toContain("multipart/form-data");
    expect(seen?.body).toContain('filename="upload.txt"');
    expect(seen?.body.toLowerCase()).toContain("content-type: text/plain");
    expect(seen?.body).toContain("file-content");
  });

  it("dry-runs a 402 by returning headers/body without payment execution", async () => {
    const home = await useTempHome();
    const headersPath = join(home, "payment-headers.txt");
    const server = await testServer((_request, response) => {
      response.statusCode = 402;
      response.setHeader(
        "www-authenticate",
        'Payment realm="example", method="tempo", intent="charge", request="abc"',
      );
      response.end("Payment Required");
    });
    const stdout = captureStdout();

    await runRequest(["--dry-run", "-D", headersPath, server.url("/paid")], { stdout });

    expect(stdout.text()).toBe("Payment Required");
    expect(await readFile(headersPath, "utf8")).toContain("www-authenticate");
  });

  it("ignores x402 payment-required headers when a Tempo payment challenge is present", async () => {
    const method = Method.from({
      name: "tempo",
      intent: "charge",
      schema: {
        credential: { payload: z.object({ ok: z.boolean() }) },
        request: z.object({
          amount: z.string(),
          currency: z.string(),
          methodDetails: z.optional(z.record(z.string(), z.unknown())),
          recipient: z.string(),
        }),
      },
    });
    const payment = Mppx.create({
      methods: [
        Method.toClient(method, {
          async createCredential({ challenge }) {
            return Credential.serialize({ challenge, payload: { ok: true } });
          },
        }),
      ],
      polyfill: false,
    });
    const challenge = Challenge.from({
      id: "stable-social-test",
      intent: "charge",
      method: "tempo",
      realm: "stablesocial.dev",
      request: {
        amount: "60000",
        currency: "0x20c000000000000000000000b9537d11c60e8b50",
        methodDetails: { chainId: 4217 },
        recipient: "0xCfA26F13c6C18307033EcE13BBb8F470dA5b4dbE",
      },
    });
    const response = new Response(null, {
      headers: {
        "payment-required": "not-base64-json",
        "www-authenticate": Challenge.serialize(challenge),
      },
      status: 402,
    });

    const credential = await payment.createCredential(tempoPaymentChallengeResponse(response));

    expect(response.headers.has("payment-required")).toBe(true);
    expect(Credential.deserialize(credential).payload).toEqual({ ok: true });
  });

  it("returns E_PAYMENT for non-dry-run 402 responses", async () => {
    const server = await testServer((_request, response) => {
      response.statusCode = 402;
      response.end("Payment Required");
    });

    await expect(
      runRequest([server.url("/paid")], { stdout: captureStdout() }),
    ).rejects.toMatchObject({
      code: "E_PAYMENT",
      exitCode: 4,
    });
  });

  it("accepts request global/payment compatibility flags", () => {
    expect(
      parseRequestArgs([
        "-t",
        "--max-spend",
        "1.00",
        "--connect-timeout",
        "2",
        "--insecure",
        "--no-proxy",
        "--max-redirs",
        "3",
        "https://example.com",
      ]),
    ).toMatchObject({
      connectTimeout: 2,
      insecure: true,
      maxRedirs: 3,
      maxSpend: "1.00",
      noProxy: true,
      url: "https://example.com",
    });
  });

  it("recovers stale session locks left behind by killed request processes", async () => {
    const home = await useTempHome();
    const lockDir = join(home, ".tempo", "wallet", "session-locks");
    const lockPath = join(lockDir, "https___rpc.mpp.tempo.xyz.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, "99999999\n2026-01-01T00:00:00.000Z\n");

    const result = await withSessionLock("https://rpc.mpp.tempo.xyz/", async () => "ok");

    expect(result).toBe("ok");
  });

  it("persists Rust-compatible session channel rows with monotonic cumulative fields", async () => {
    await useTempHome();
    const origin = "https://paid.example.com";
    const channelId = `0x${"1".repeat(64)}`;
    await upsertSessionRecord({
      accepted_cumulative: 0n,
      authorized_signer: "0x0000000000000000000000000000000000000aaa",
      chain_id: 4217,
      challenge_echo: "{}",
      channel_id: channelId,
      close_requested_at: 0,
      created_at: 1,
      cumulative_amount: 100n,
      deposit: 1000n,
      escrow_contract: "0x0000000000000000000000000000000000000bbb",
      grace_ready_at: 0,
      last_used_at: 1,
      network: "tempo",
      origin,
      payee: "0x0000000000000000000000000000000000000ccc",
      payer: "0x0000000000000000000000000000000000000aaa",
      request_url: `${origin}/api`,
      salt: "0x00",
      server_spent: 0n,
      session_protocol: "v1",
      state: "active",
      token: "0x0000000000000000000000000000000000000ddd",
    });
    await preserveSessionCumulative(channelId, 200n);
    await updateSessionReceipt({
      acceptedCumulative: 150n,
      channelId,
      serverSpent: 125n,
      signedCumulative: 175n,
    });

    const rows = await readSessionRecordsByOrigin(origin);
    const reusable = await findReusableSession({
      authorizedSigner: "0x0000000000000000000000000000000000000aaa",
      chainId: 4217,
      escrowContract: "0x0000000000000000000000000000000000000bbb",
      origin,
      payee: "0x0000000000000000000000000000000000000ccc",
      payer: "0x0000000000000000000000000000000000000aaa",
      token: "0x0000000000000000000000000000000000000ddd",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cumulative_amount).toBe(200n);
    expect(rows[0]?.accepted_cumulative).toBe(150n);
    expect(rows[0]?.server_spent).toBe(125n);
    expect(reusable?.channel_id).toBe(channelId);
  });

  it("preserves pending key authorizations from wallet storage for local access-key payments", async () => {
    await useTempHome();
    const keyAuthorization = {
      address: testAccessKey,
      chainId: 4217n,
      expiry: 1783809942,
      limits: [{ token: "0x20C000000000000000000000b9537d11c60E8b50", limit: 100000000n }],
      signature: { type: "secp256k1", signature: "0x1234" },
      type: "secp256k1",
    };
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            expiry: 2_000_000_000,
            keyAuthorization,
          },
        ],
      }),
    );

    const state = await loadWalletState();
    const identity = await storedAccessKeyIdentity(
      state,
      requestOptions("https://paid.example.com"),
    );
    const stored = await identity?.account.keyAuthorizationManager?.get({
      address: testWallet,
      accessKey: testAccessKey,
      chainId: 4217,
    });

    expect(identity?.signerAddress.toLowerCase()).toBe(testAccessKey.toLowerCase());
    expect(stored).toStrictEqual(keyAuthorization);
  });

  it("uses a stored secp256k1 access key for MPP session vouchers", async () => {
    await useTempHome();
    const p256Keystore = Keystore.webCryptoP256({ extractable: true });
    const p256Key = await p256Keystore.createKey();
    const p256Account = await p256Keystore.toAccount(
      { ...p256Key, keyType: "p256" },
      { access: testWallet, keyAuthorizationManager: KeyAuthorizationManager.memory() },
    );
    const secp256k1Keystore = Keystore.secp256k1();
    const secp256k1Key = await secp256k1Keystore.createKey();
    const secp256k1Account = await secp256k1Keystore.toAccount(
      { ...secp256k1Key, keyType: "secp256k1" },
      { access: testWallet, keyAuthorizationManager: KeyAuthorizationManager.memory() },
    );
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            address: p256Account.accessKeyAddress,
            access: testWallet,
            chainId: 4217,
            handle: p256Key.handle,
            keyType: "p256",
            limits: [],
            publicKey: p256Key.publicKey,
          },
          {
            address: secp256k1Account.accessKeyAddress,
            access: testWallet,
            chainId: 4217,
            handle: secp256k1Key.handle,
            keyType: "secp256k1",
            limits: [],
            publicKey: secp256k1Key.publicKey,
          },
        ],
      }),
    );

    const identity = await resolveSessionPaymentIdentity(
      requestOptions("https://paid.example.com"),
    );

    expect(identity.signerAddress.toLowerCase()).toBe(
      secp256k1Account.accessKeyAddress.toLowerCase(),
    );
    expect(identity.methodOptions).toMatchObject({
      account: {
        accessKeyAddress: secp256k1Account.accessKeyAddress,
        keyType: "secp256k1",
      },
      mode: "pull",
    });
  });

  it("rejects a P-256 access key before creating an MPP session voucher", async () => {
    await useTempHome();
    const keystore = Keystore.webCryptoP256({ extractable: true });
    const { handle, publicKey } = await keystore.createKey();
    const account = await keystore.toAccount(
      { handle, keyType: "p256", publicKey },
      { access: testWallet, keyAuthorizationManager: KeyAuthorizationManager.memory() },
    );
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            address: account.accessKeyAddress,
            access: testWallet,
            chainId: 4217,
            handle,
            keyType: "p256",
            limits: [],
            publicKey,
          },
        ],
      }),
    );

    await expect(
      resolveSessionPaymentIdentity(requestOptions("https://paid.example.com")),
    ).rejects.toMatchObject({
      code: "E_PAYMENT",
      message: expect.stringMatching(
        /MPP session vouchers require an active, unexpired secp256k1 access key.*P-256\/WebAuthn.*passkey wallet is supported.*tempo wallet refresh.*tempo wallet sessions close --all.*sponsored transaction.*discard/is,
      ),
    });
  });

  it("uses stored P-256 access keys for payment identity resolution", async () => {
    await useTempHome();
    const keystore = Keystore.webCryptoP256({ extractable: true });
    const { handle, publicKey } = await keystore.createKey();
    const account = await keystore.toAccount(
      { handle, keyType: "p256", publicKey },
      { access: testWallet, keyAuthorizationManager: KeyAuthorizationManager.memory() },
    );
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            address: account.accessKeyAddress,
            access: testWallet,
            chainId: 4217,
            expiry: 2_000_000_000,
            handle,
            keyType: "p256",
            limits: [],
            publicKey,
          },
        ],
      }),
    );

    const identity = await resolvePaymentIdentity(requestOptions("https://paid.example.com"));

    expect(identity.address.toLowerCase()).toBe(testWallet.toLowerCase());
    expect(identity.signerAddress.toLowerCase()).toBe(account.accessKeyAddress.toLowerCase());
    expect(identity.methodOptions).toMatchObject({
      account: { accessKeyAddress: account.accessKeyAddress, keyType: "p256" },
      mode: "pull",
    });

    if (!("account" in identity)) throw new Error("expected a stored access-key identity");
    const client = createClient({
      account: identity.account,
      chain: { id: 4217 } as never,
      transport: custom({
        async request({ method }) {
          if (method === "eth_chainId") return "0x1079";
          throw new Error(`unexpected RPC request: ${method}`);
        },
      }),
    });
    const payment = tempoSession({
      account: identity.account,
      decimals: 0,
      getClient: () => client,
    });
    const descriptor = {
      authorizedSigner: account.accessKeyAddress,
      expiringNonceHash: `0x${"22".repeat(32)}` as `0x${string}`,
      operator: "0x0000000000000000000000000000000000000000",
      payee: "0x0000000000000000000000000000000000000002",
      payer: account.address,
      salt: `0x${"11".repeat(32)}` as `0x${string}`,
      token: "0x20C000000000000000000000b9537d11c60E8b50",
    } as const;
    const credential = await payment.createCredential({
      challenge: {
        id: "test",
        intent: "session",
        method: "tempo",
        realm: "rpc.mpp.tempo.xyz",
        request: {
          amount: "1",
          currency: descriptor.token,
          methodDetails: {
            chainId: 4217,
            escrowContract: "0x4d50500000000000000000000000000000000000",
            sessionProtocol: "v2",
          },
          recipient: descriptor.payee,
        },
      } as never,
      context: {
        action: "voucher",
        cumulativeAmountRaw: "1",
        descriptor,
      },
    });
    const payload = Credential.deserialize<Record<string, unknown>>(credential).payload;

    expect(payload).toMatchObject({
      action: "voucher",
      descriptor: { authorizedSigner: account.accessKeyAddress },
    });
  });

  it("keeps v2 session descriptors for reuse", async () => {
    await useTempHome();
    const origin = "https://paid.example.com";
    const channelId = `0x${"2".repeat(64)}`;
    const descriptor = {
      authorizedSigner: testAccessKey,
      expiringNonceHash: `0x${"3".repeat(64)}`,
      operator: "0x0000000000000000000000000000000000000000",
      payee: "0x0000000000000000000000000000000000000ccc",
      payer: testWallet,
      salt: `0x${"4".repeat(64)}`,
      token: "0x0000000000000000000000000000000000000ddd",
    };
    await upsertSessionRecord({
      accepted_cumulative: 100n,
      authorized_signer: testAccessKey,
      chain_id: 4217,
      challenge_echo: "{}",
      channel_id: channelId,
      close_requested_at: 0,
      created_at: 1,
      cumulative_amount: 100n,
      deposit: 1000n,
      descriptor_json: JSON.stringify(descriptor),
      escrow_contract: "0x4d50500000000000000000000000000000000000",
      grace_ready_at: 0,
      last_used_at: 1,
      network: "tempo",
      origin,
      payee: descriptor.payee,
      payer: testWallet,
      request_url: `${origin}/api`,
      salt: descriptor.salt,
      server_spent: 100n,
      session_protocol: "v2",
      state: "active",
      token: descriptor.token,
    });

    const reusable = await findReusableSession({
      authorizedSigner: testAccessKey,
      chainId: 4217,
      escrowContract: "0x4d50500000000000000000000000000000000000",
      origin,
      payee: descriptor.payee,
      payer: testWallet,
      token: descriptor.token,
    });

    expect(reusable?.session_protocol).toBe("v2");
    expect(reusable?.descriptor_json).toBe(JSON.stringify(descriptor));
  });

  it("does not invalidate reusable sessions for ordinary upstream 404 responses", async () => {
    await expect(
      isSessionInvalidationResponse(
        new Response(JSON.stringify({ error: { message: "model not found" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    ).resolves.toBe(false);

    await expect(
      isSessionInvalidationResponse(
        new Response("session channel not found", {
          status: 404,
          headers: { "www-authenticate": "Payment method=tempo" },
        }),
      ),
    ).resolves.toBe(true);
  });

  it("builds v2 top-up transactions as one descriptor-based precompile call with fee payer", () => {
    const descriptor = sessionDescriptor();
    const request = buildTopUpTransactionRequest({
      additionalDeposit: 5_000n,
      details: {
        feePayer: true,
        token: descriptor.token,
      },
      record: {
        channel_id: `0x${"5".repeat(64)}`,
        descriptor_json: JSON.stringify(descriptor),
        escrow_contract: TempoChannel.address,
      },
    });

    expect(request.feePayer).toBe(true);
    expect(request.feeToken).toBe(descriptor.token);
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0]?.to.toLowerCase()).toBe(TempoChannel.address.toLowerCase());

    const decoded = decodeFunctionData({
      abi: TempoAbis.tip20ChannelReserve,
      data: request.calls[0]!.data,
    });
    expect(decoded.functionName).toBe("topUp");
    expect(normalizeDescriptor(decoded.args[0])).toEqual(normalizeDescriptor(descriptor));
    expect(decoded.args[1]).toBe(5_000n);
  });
});

function requestOptions(url: string): ReturnType<typeof parseRequestArgs> {
  return parseRequestArgs([url]);
}

function sessionDescriptor() {
  return {
    authorizedSigner: testAccessKey,
    expiringNonceHash: `0x${"3".repeat(64)}` as `0x${string}`,
    operator: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    payee: "0x0000000000000000000000000000000000000ccc" as `0x${string}`,
    payer: testWallet,
    salt: `0x${"4".repeat(64)}` as `0x${string}`,
    token: "0x0000000000000000000000000000000000000ddd" as `0x${string}`,
  };
}

function normalizeDescriptor(value: unknown) {
  const descriptor = value as ReturnType<typeof sessionDescriptor>;
  return {
    ...descriptor,
    authorizedSigner: descriptor.authorizedSigner.toLowerCase(),
    operator: descriptor.operator.toLowerCase(),
    payee: descriptor.payee.toLowerCase(),
    payer: descriptor.payer.toLowerCase(),
    token: descriptor.token.toLowerCase(),
  };
}

async function testServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
) {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server address");
  const close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  const managed = { close };
  servers.push(managed);
  return {
    ...managed,
    url(path: string) {
      return `http://127.0.0.1:${address.port}${path}`;
    },
  };
}

function captureStdout() {
  let output = "";
  return {
    write(chunk: string | Uint8Array) {
      output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return true;
    },
    text() {
      return output;
    },
  };
}

async function readSeenRequest(request: IncomingMessage): Promise<SeenRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers: request.headers,
    method: request.method ?? "",
    url: request.url ?? "",
  };
}
