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
  chargeFallbackError,
  isSessionInvalidationResponse,
  parseRequestArgs,
  redirectRequest,
  resolvePaymentIdentity,
  runRequest,
  selectPaymentTokenResponse,
  sessionChallengeFromHeader,
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

  it("strips credentials on cross-origin redirects", () => {
    const redirected = redirectRequest(
      {
        init: {
          headers: {
            Authorization: "Bearer secret-token",
            Cookie: "session=secret-cookie",
            "Proxy-Authorization": "Basic proxy-secret",
          },
          method: "GET",
        },
        url: "https://api.example.com/redirect",
      },
      302,
      "https://other.example.com/target",
    );
    const headers = new Headers(redirected.init.headers);

    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("proxy-authorization")).toBeNull();
  });

  it("preserves credentials on same-origin redirects", () => {
    const redirected = redirectRequest(
      {
        init: {
          headers: {
            Authorization: "Bearer secret-token",
            Cookie: "session=secret-cookie",
            "Proxy-Authorization": "Basic proxy-secret",
          },
          method: "GET",
        },
        url: "https://api.example.com/redirect",
      },
      302,
      "/target",
    );
    const headers = new Headers(redirected.init.headers);

    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("cookie")).toBe("session=secret-cookie");
    expect(headers.get("proxy-authorization")).toBe("Basic proxy-secret");
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

  it("selects only challenges for the requested payment token", () => {
    const selectedToken = "0x1111111111111111111111111111111111111111";
    const otherToken = "0x2222222222222222222222222222222222222222";
    const selected = paymentChallenge({
      amount: "15000",
      id: "selected-token",
      intent: "charge",
      chainId: 4217,
      currency: selectedToken,
    });
    const other = paymentChallenge({
      amount: "15000",
      id: "other-token",
      intent: "charge",
      chainId: 4217,
      currency: otherToken,
    });
    const response = new Response(null, {
      headers: {
        "www-authenticate": [other, selected]
          .map((challenge) => Challenge.serialize(challenge))
          .join(", "),
      },
      status: 402,
    });

    const filtered = selectPaymentTokenResponse(response, selectedToken.toUpperCase());

    expect(Challenge.fromResponseList(filtered).map((challenge) => challenge.id)).toEqual([
      "selected-token",
    ]);
  });

  it("reports available tokens when the selected token was not offered", () => {
    const offeredToken = "0x1111111111111111111111111111111111111111";
    const response = new Response(null, {
      headers: {
        "www-authenticate": Challenge.serialize(
          paymentChallenge({
            amount: "15000",
            id: "offered-token",
            intent: "charge",
            chainId: 4217,
            currency: offeredToken,
          }),
        ),
      },
      status: 402,
    });

    expect(() =>
      selectPaymentTokenResponse(response, "0x2222222222222222222222222222222222222222"),
    ).toThrow(`Available tokens: ${offeredToken}`);
  });

  it.each([
    { name: "unversioned", protocols: [undefined], selectedId: undefined },
    { name: "v1", protocols: ["v1"], selectedId: undefined },
    { name: "v2", protocols: ["v2"], selectedId: "session-v2" },
    { name: "mixed v1 and v2", protocols: ["v1", "v2"], selectedId: "session-v2" },
  ])(
    "uses session-first routing only for $name session challenges",
    ({ protocols, selectedId }) => {
      const charge = Challenge.from({
        id: "charge",
        intent: "charge",
        method: "tempo",
        realm: "example",
        request: {
          amount: "1",
          currency: "0x20c000000000000000000000b9537d11c60e8b50",
          methodDetails: { chainId: 4217 },
          recipient: "0x0000000000000000000000000000000000000001",
        },
      });
      const sessions = protocols.map((protocol) =>
        Challenge.from({
          id: `session-${protocol ?? "unversioned"}`,
          intent: "session",
          method: "tempo",
          realm: "example",
          request: {
            amount: "1",
            currency: "0x20c000000000000000000000b9537d11c60e8b50",
            methodDetails: {
              chainId: 4217,
              ...(protocol ? { sessionProtocol: protocol } : {}),
            },
            recipient: "0x0000000000000000000000000000000000000001",
          },
        }),
      );
      const header = [charge, ...sessions]
        .map((challenge) => Challenge.serialize(challenge))
        .join(", ");

      expect(sessionChallengeFromHeader(header)?.id).toBe(selectedId);
    },
  );

  it("reports an offered charge without submitting it after session failure", () => {
    const session = paymentChallenge({
      amount: "15000",
      id: "session",
      intent: "session",
      chainId: 4217,
      currency: "0x20c000000000000000000000b9537d11c60e8b50",
      sessionProtocol: "v2",
    });
    const charge = paymentChallenge({
      amount: "15000",
      id: "charge",
      intent: "charge",
      chainId: 4217,
      currency: "0x20c000000000000000000000b9537d11c60e8b50",
    });
    const header = [charge, session].map((challenge) => Challenge.serialize(challenge)).join(", ");

    expect(
      chargeFallbackError(
        header,
        session,
        requestOptions("https://example.com"),
        "extension failed",
      ),
    ).toMatchObject({
      code: "E_PAYMENT",
      message:
        "Session payment failed: extension failed\nA one-time charge of 0.015 is available but was not submitted because charge capacity is non-refundable. Review the amount, then retry with --max-spend 0.015 --payment-intent charge.",
    });
  });

  it("selects the cheapest compatible charge using normalized chain IDs", () => {
    const currency = "0x20c000000000000000000000b9537d11c60e8b50";
    const session = paymentChallenge({
      amount: "15000",
      id: "session",
      intent: "session",
      currency,
      sessionProtocol: "v2",
    });
    const expensive = paymentChallenge({
      amount: "25000",
      id: "expensive",
      intent: "charge",
      chainId: 4217,
      currency,
    });
    const cheapest = paymentChallenge({
      amount: "15000",
      id: "cheapest",
      intent: "charge",
      chainId: 4217,
      currency,
    });
    const header = [session, expensive, cheapest]
      .map((challenge) => Challenge.serialize(challenge))
      .join(", ");

    expect(
      chargeFallbackError(header, session, requestOptions("https://example.com"), "failed")
        ?.message,
    ).toContain("one-time charge of 0.015");
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

  it("fails before payment construction when the stored access key needs refresh", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            expiry: 1,
            keyAuthorization: "0x1234",
          },
        ],
      }),
    );
    const charge = paymentChallenge({
      amount: "7000",
      id: "expired-key-charge",
      intent: "charge",
      chainId: 4217,
      currency: "0x20c000000000000000000000b9537d11c60e8b50",
    });
    const session = paymentChallenge({
      amount: "7000",
      id: "expired-key-session",
      intent: "session",
      chainId: 4217,
      currency: "0x20c000000000000000000000b9537d11c60e8b50",
      sessionProtocol: "v2",
    });
    const header = [charge, session].map((challenge) => Challenge.serialize(challenge)).join(", ");
    let requests = 0;
    const server = await testServer((_request, response) => {
      requests += 1;
      response.statusCode = 402;
      response.setHeader("www-authenticate", header);
      response.end("Payment Required");
    });

    await expect(
      runRequest([server.url("/paid")], { stdout: captureStdout() }),
    ).rejects.toMatchObject({
      code: "E_AUTH_REFRESH_REQUIRED",
      exitCode: 4,
      message: "The configured access key is expired. Run 'tempo wallet refresh' before retrying.",
    });
    expect(requests).toBe(1);
  });

  it("rejects a noncanonical Tempo session escrow before creating a credential", async () => {
    let requests = 0;
    const challenge = Challenge.from({
      id: "untrusted-session-escrow",
      intent: "session",
      method: "tempo",
      realm: "example",
      request: {
        amount: "1",
        currency: "0x20c000000000000000000000b9537d11c60e8b50",
        methodDetails: {
          chainId: 4217,
          escrowContract: "0x0000000000000000000000000000000000000bad",
          sessionProtocol: "v2",
        },
        recipient: "0x0000000000000000000000000000000000000001",
      },
    });
    const server = await testServer((_request, response) => {
      requests++;
      response.statusCode = 402;
      response.setHeader("www-authenticate", Challenge.serialize(challenge));
      response.end("Payment Required");
    });

    await expect(
      runRequest([server.url("/paid")], { stdout: captureStdout() }),
    ).rejects.toMatchObject({
      code: "E_PAYMENT",
      message: expect.stringContaining("Unsupported Tempo session escrow"),
    });
    expect(requests).toBe(1);
  });

  it("accepts request global/payment compatibility flags", () => {
    expect(
      parseRequestArgs([
        "-t",
        "--max-spend",
        "1.00",
        "--payment-intent",
        "charge",
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
      paymentIntent: "charge",
      noProxy: true,
      url: "https://example.com",
    });
  });

  it("defaults payment intent to auto and rejects unknown values", () => {
    expect(parseRequestArgs(["https://example.com"]).paymentIntent).toBe("auto");
    expect(() => parseRequestArgs(["--payment-intent", "refund", "https://example.com"])).toThrow(
      "--payment-intent must be one of: auto, session, charge",
    );
  });

  it("accepts an exact payment token address and rejects ambiguous names", () => {
    const token = "0x1111111111111111111111111111111111111111";
    expect(parseRequestArgs(["--payment-token", token, "https://example.com"]).paymentToken).toBe(
      token,
    );
    expect(() => parseRequestArgs(["--payment-token", "MACH", "https://example.com"])).toThrow(
      "--payment-token must be a 0x token address",
    );
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
      expiry: 2_000_000_000,
      limits: [{ token: "0x20C000000000000000000000b9537d11c60E8b50", limit: 100000000n }],
      signature: { type: "secp256k1", signature: "0x1234" },
      type: "secp256k1",
    };
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
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

  it.each([
    {
      name: "expired",
      overrides: { expiry: 1 },
    },
    {
      name: "legacy authorization",
      overrides: { expiry: 2_000_000_000, keyAuthorization: "0x1234" },
    },
  ])("does not use a stored $name access key for payments", async ({ overrides }) => {
    const identity = await storedAccessKeyIdentity(
      walletState({
        accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }],
      }),
      requestOptions("https://paid.example.com"),
    );

    expect(identity).toBeUndefined();
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
        chain_id: 4217,
        channel_id: `0x${"5".repeat(64)}`,
        descriptor_json: JSON.stringify(descriptor),
        escrow_contract: TempoChannel.address,
        session_protocol: "v2",
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

  it("rejects top-ups for stored noncanonical session escrows", () => {
    expect(() =>
      buildTopUpTransactionRequest({
        additionalDeposit: 5_000n,
        details: {
          feePayer: false,
          token: "0x20c000000000000000000000b9537d11c60e8b50",
        },
        record: {
          chain_id: 4217,
          channel_id: `0x${"5".repeat(64)}`,
          descriptor_json: JSON.stringify(sessionDescriptor()),
          escrow_contract: "0x0000000000000000000000000000000000000bad",
          session_protocol: "v2",
        },
      }),
    ).toThrow("Unsupported Tempo session escrow");
  });
});

function requestOptions(url: string): ReturnType<typeof parseRequestArgs> {
  return parseRequestArgs([url]);
}

function paymentChallenge(options: {
  amount: string;
  chainId?: number | undefined;
  currency: string;
  id: string;
  intent: "charge" | "session";
  sessionProtocol?: "v2" | undefined;
}) {
  return Challenge.from({
    id: options.id,
    intent: options.intent,
    method: "tempo",
    realm: "example",
    request: {
      amount: options.amount,
      currency: options.currency,
      methodDetails: {
        ...(options.chainId ? { chainId: options.chainId } : {}),
        ...(options.sessionProtocol ? { sessionProtocol: options.sessionProtocol } : {}),
      },
      recipient: "0x0000000000000000000000000000000000000001",
    },
  });
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
