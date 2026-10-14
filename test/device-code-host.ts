import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { testWallet } from "./helpers.js";

/** How the host answers one `/token` poll. */
export type TokenAnswer = "pending" | "slow_down" | "approve" | "deny" | "expire" | "unavailable";

const tokenErrors = {
  pending: "authorization_pending",
  slow_down: "slow_down",
  deny: "access_denied",
  expire: "expired_token",
} as const;

/**
 * The wallet's device-code endpoints, as `wallet.tempo.xyz/api/auth/device` serves them:
 * `/register` issues a code for the CLI's `wallet_connect`, and `/token` checks the PKCE
 * verifier, then answers poll `n` (from 1) with `answer(n)`. An approval authorizes the
 * access key the CLI registered, for `testWallet`.
 */
export function deviceCodeHost(
  answer: (poll: number) => TokenAnswer,
  options: { expiresIn?: number; interval?: number } = {},
) {
  const registrations: Registration[] = [];
  const polls: { device_code: string; code_verifier: string }[] = [];

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/api/auth/device/register")) {
      const registration = (await request.json()) as Registration;
      registrations.push(registration);
      const userCode = `ABCDEFG${registrations.length}`;
      return Response.json({
        device_code: `device-${registrations.length}`,
        user_code: userCode,
        verification_uri: `${url.origin}/api/auth/device/verify`,
        verification_uri_complete: `${url.origin}/api/auth/device/verify?user_code=${userCode}`,
        expires_in: options.expiresIn ?? 600,
        // Seconds, as RFC 8628 specifies; tests poll fast.
        interval: options.interval ?? 0.01,
      });
    }
    if (url.pathname.endsWith("/api/auth/device/token")) {
      const poll = (await request.json()) as (typeof polls)[number];
      polls.push(poll);
      const registration = registrations[Number(poll.device_code.replace("device-", "")) - 1];
      const challenge = createHash("sha256").update(poll.code_verifier).digest("base64url");
      if (!registration || registration.code_challenge !== challenge)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      const result = answer(polls.length);
      if (result === "approve") return Response.json(approval(registration));
      if (result === "unavailable") return new Response("Service Unavailable", { status: 503 });
      return Response.json({ error: tokenErrors[result] }, { status: 400 });
    }
    // Chain RPC and other reads see an empty result.
    return Response.json([]);
  }

  return {
    registrations,
    polls,
    fetch: (input: string | URL | Request, init?: RequestInit) => handle(new Request(input, init)),
    /** Serves the host over HTTP for CLI subprocesses; point `TEMPO_AUTH_URL` at `url`. */
    async listen() {
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const reply = await handle(
          new Request(`http://${request.headers.host}${request.url}`, {
            method: request.method ?? "GET",
            headers: { "content-type": "application/json" },
            ...(request.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
          }),
        );
        response.writeHead(reply.status, { "content-type": "application/json" });
        response.end(await reply.text());
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP address");
      return {
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    },
  };
}

type Registration = {
  code_challenge: string;
  message: {
    payload: {
      id: number;
      params: [{ chainId: string; capabilities: { authorizeAccessKey: AuthorizeAccessKey } }];
    }[];
  };
};

type AuthorizeAccessKey = {
  address: string;
  chainId: string;
  expiry: number;
  keyType: string;
  publicKey: string;
};

/** The wallet's `wallet_connect` response: `testWallet`, authorizing the registered key. */
function approval(registration: Registration) {
  const [request] = registration.message.payload;
  const key = request!.params[0].capabilities.authorizeAccessKey;
  return {
    type: "rpc-responses",
    payload: [
      {
        id: request!.id,
        jsonrpc: "2.0",
        result: {
          accounts: [
            {
              address: testWallet,
              capabilities: {
                keyAuthorization: {
                  keyId: key.address,
                  chainId: key.chainId,
                  expiry: key.expiry,
                  keyType: key.keyType,
                  limits: [],
                  signature: {
                    type: "secp256k1",
                    r: `0x${"1".repeat(64)}`,
                    s: `0x${"2".repeat(64)}`,
                    yParity: "0x0",
                  },
                },
              },
            },
          ],
        },
      },
    ],
  };
}
