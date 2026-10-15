import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { testWallet2, usdc, useTempHome, walletState, writeWalletState } from "./helpers.js";

const execFileAsync = promisify(execFile);

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
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

const mainnet = { chain_id: 4217, network: "tempo" };
const testnet = { chain_id: 42431, network: "tempo-moderato" };

it.each([
  "whoami -n testnet",
  "-n testnet whoami",
  "whoami --network=testnet",
  "--network moderato whoami",
  "doctor --network tempo-moderato",
  "sessions list -n testnet",
  "-n testnet sessions list",
  "-n testnet sessions",
  "doctor -jn testnet",
  "whoami -sn testnet",
])(
  "accepts the network global in `%s`",
  async (command) => {
    await useTempHome();

    expect(await walletJson(command.split(" "))).toMatchObject(testnet);
  },
  30_000,
);

it.each([
  { source: "the logged-in chain", env: undefined, args: [], expected: testnet },
  { source: "TEMPO_WALLET_NETWORK", env: "mainnet", args: [], expected: mainnet },
  { source: "--network", env: "mainnet", args: ["-n", "testnet"], expected: testnet },
])(
  "whoami selects $expected.network from $source",
  async ({ env, args, expected }) => {
    await useTempHome();
    await writeWalletState(walletState({ chainId: 42431 }));

    expect(await walletJson(["whoami", ...args], env)).toMatchObject(expected);
  },
  30_000,
);

it("rejects an unknown network as a usage error", async () => {
  await useTempHome();

  const error = await walletJson(["whoami", "-n", "typo"]).catch((value: unknown) => value);
  expect(error).toMatchObject({ code: 2 });
  expect(JSON.parse((error as { stdout: string }).stdout)).toMatchObject({
    code: "E_USAGE",
    message: "Unsupported network: typo",
  });
});

// incur extracts globals from the whole argv, so option values that look like `--network`
// must stay bound to their option.
it.each(["-n", "--network", "--network=testnet"])(
  "keeps `%s` as the transfer --fee-token value",
  async (value) => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await walletJson([
      "transfer",
      "--dry-run",
      "--fee-token",
      value,
      "1",
      usdc,
      testWallet2,
    ]).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: 2 });
    expect(JSON.parse((error as { stdout: string }).stdout)).toMatchObject({
      code: "E_USAGE",
      message: expect.stringContaining(`Unknown fee token "${value}" on mainnet.`),
    });
  },
  30_000,
);

it.each([
  { args: ["-d", "-n"], body: "-n" },
  { args: ["--data", "--network"], body: "--network" },
  { args: ["-d", "--network=testnet", "--include"], body: "--network=testnet", include: true },
  { args: ["--data-urlencode", "--network"], body: "--network" },
  {
    args: ["-u", "--network=a:b"],
    authorization: `Basic ${Buffer.from("--network=a:b").toString("base64")}`,
  },
])(
  "keeps request option values $args out of the network global",
  async ({ args, body, authorization, include }) => {
    const url = await echoServer();

    const { stdout } = await execFileAsync(process.execPath, [cliBundle("request"), ...args, url]);

    expect(stdout.startsWith("HTTP 200")).toBe(include === true);
    expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toMatchObject({
      ...(body !== undefined ? { body } : {}),
      ...(authorization !== undefined ? { authorization } : {}),
    });
  },
  30_000,
);

it("reports a dash-prefixed -H value as an invalid header", async () => {
  const url = await echoServer();

  const error = await execFileAsync(process.execPath, [
    cliBundle("request"),
    "-H",
    "--network",
    "--format",
    "json",
    url,
  ]).catch((value: unknown) => value as { stderr: string });

  expect(JSON.parse(error.stderr)).toMatchObject({
    code: "E_USAGE",
    message: "Invalid header: --network",
  });
}, 30_000);

/** Responds with the request body and authorization it received. */
async function echoServer() {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ body, authorization: request.headers.authorization ?? null }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return `http://127.0.0.1:${address.port}/echo`;
}

async function walletJson(args: string[], network?: string | undefined) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliBundle("wallet"), ...args, "--format", "json"],
    { env: { ...process.env, TEMPO_WALLET_NETWORK: network } },
  );
  return JSON.parse(stdout) as unknown;
}
