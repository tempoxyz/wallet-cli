import { createServer, type Server } from "node:http";

import { Agent, fetch as undiciFetch } from "undici";
import { afterEach, expect, it } from "vitest";

import { blockedHosts } from "./setup.js";

// TEST-NET-1 is never routed, so a request the guard misses fails instead of leaving the machine.
const outbound = "http://192.0.2.1/";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

it.each([
  { client: "global fetch", redirected: false, fetch: (url: string) => fetch(url) },
  { client: "global fetch", redirected: true, fetch: (url: string) => fetch(url) },
  {
    client: "the undici fetch tempo request sends with its own agent",
    redirected: false,
    fetch: (url: string) => undiciFetch(url, { dispatcher: new Agent() }),
  },
  {
    client: "the undici fetch tempo request sends with its own agent",
    redirected: true,
    fetch: (url: string) => undiciFetch(url, { dispatcher: new Agent() }),
  },
])(
  "refuses $client reaching another host (redirected from loopback: $redirected)",
  async ({ redirected, fetch }) => {
    const url = redirected ? await redirectTo(outbound) : outbound;

    await expect(fetch(url)).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Tests must not connect to 192.0.2.1:80") },
    });
    expect(blockedHosts.splice(0)).toEqual(["192.0.2.1:80"]);
  },
);

/** A loopback server that redirects every request to `location`. */
async function redirectTo(location: string) {
  const server = createServer((_request, response) => {
    response.writeHead(302, { location }).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return `http://127.0.0.1:${address.port}/`;
}
