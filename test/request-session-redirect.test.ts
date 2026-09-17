import { createServer } from "node:http";
import { Challenge, Credential } from "mppx";
import { afterEach, expect, it, vi } from "vitest";

import { runRequest } from "../src/commands/request.js";
import { useTempHome } from "./helpers.js";

const { credentialOptions, getBalance } = vi.hoisted(() => ({
  credentialOptions: [] as unknown[],
  getBalance: vi.fn(async (_client: unknown) => ({ amount: 1_000_000n })),
}));

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getBalance },
    },
  };
});

vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: () => ({
        createCredential: async (response: Response, options?: unknown) => {
          credentialOptions.push(options);
          return Credential.serialize({
            challenge: Challenge.fromResponseList(response)[0]!,
            payload: { channelId: `0x${"1".repeat(64)}` },
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

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  delete process.env.TEMPO_WALLET_NETWORK;
  credentialOptions.length = 0;
  getBalance.mockClear();
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

it.each([
  {
    name: "302 redirect",
    redirectStatus: 302,
    paidMethod: "GET",
    paidBody: "",
    paidContentType: undefined,
    amount: "1",
    suggestedDeposit: undefined,
    maxSpend: undefined,
    expectedDeposit: "1",
  },
  {
    name: "307 redirect",
    redirectStatus: 307,
    paidMethod: "POST",
    paidBody: '{"hello":"world"}',
    paidContentType: "application/json",
    amount: "1",
    suggestedDeposit: undefined,
    maxSpend: undefined,
    expectedDeposit: "1",
  },
  {
    name: "zero spending cap",
    redirectStatus: 307,
    paidMethod: "POST",
    paidBody: '{"hello":"world"}',
    paidContentType: "application/json",
    amount: "0",
    suggestedDeposit: "1000000",
    maxSpend: "0",
    expectedDeposit: "0",
  },
])(
  "safely retries the challenged request for $name",
  async ({
    redirectStatus,
    paidMethod,
    paidBody,
    paidContentType,
    amount,
    suggestedDeposit,
    maxSpend,
    expectedDeposit,
  }) => {
    await useTempHome();
    process.env.TEMPO_WALLET_NETWORK = "testnet";
    const seen: {
      url: string | undefined;
      authenticated: boolean;
      method: string | undefined;
      body: string;
      contentType: string | undefined;
    }[] = [];
    const challenge = Challenge.from({
      id: "redirect-session",
      realm: "local",
      method: "tempo",
      intent: "session",
      request: {
        amount,
        currency: "0x20c0000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        methodDetails: { chainId: 4217, sessionProtocol: "v2" },
        ...(suggestedDeposit ? { suggestedDeposit } : {}),
      },
    });
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.push({
        url: req.url,
        authenticated: Boolean(req.headers.authorization),
        method: req.method,
        body,
        contentType: req.headers["content-type"],
      });
      if (req.url === "/redirect") {
        res.writeHead(redirectStatus, { location: "/paid" });
        res.end();
      } else if (req.headers.authorization) {
        res.end("paid result");
      } else {
        res.writeHead(402, { "www-authenticate": Challenge.serialize(challenge) });
        res.end("Payment Required");
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    let output = "";
    await runRequest(
      [
        "-L",
        "--network",
        "mainnet",
        "--payment-intent",
        "session",
        ...(maxSpend !== undefined ? ["--max-spend", maxSpend] : []),
        "--json",
        '{"hello":"world"}',
        "--private-key",
        `0x${"1".repeat(64)}`,
        `http://127.0.0.1:${address.port}/redirect`,
      ],
      {
        stdout: {
          write: ((chunk: string | Uint8Array) => {
            output += chunk.toString();
            return true;
          }) as NodeJS.WriteStream["write"],
        },
      },
    );
    expect(output).toBe("paid result");
    expect(seen).toEqual([
      {
        url: "/redirect",
        authenticated: false,
        method: "POST",
        body: '{"hello":"world"}',
        contentType: "application/json",
      },
      {
        url: "/paid",
        authenticated: false,
        method: paidMethod,
        body: paidBody,
        contentType: paidContentType,
      },
      {
        url: "/paid",
        authenticated: true,
        method: paidMethod,
        body: paidBody,
        contentType: paidContentType,
      },
    ]);
    expect(getBalance.mock.calls[0]?.[0]).toMatchObject({ chain: { id: 4217 } });
    expect(credentialOptions[0]).toMatchObject({ depositRaw: expectedDeposit });
  },
);
