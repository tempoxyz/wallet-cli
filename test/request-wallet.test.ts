import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { Challenge } from "mppx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  connect: vi.fn(),
  createProvider: vi.fn(),
}));

import { runRequest } from "../src/commands/request.js";
import { connect, createProvider } from "../src/provider.js";
import { requestDryRunOutput } from "../src/schemas/request.js";
import { emptyWalletState, type WalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  testPrivateKey,
  testPrivateKey2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const exec = promisify(execFile);
const servers: ReturnType<typeof createServer>[] = [];

beforeEach(() => {
  vi.stubEnv("TEMPO_MAX_SPEND", undefined);
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  // Dry-run balance reads fail fast instead of reaching a public RPC.
  vi.stubEnv("TEMPO_RPC_URL", "http://127.0.0.1:9");
});

afterEach(async () => {
  vi.unstubAllEnvs();
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

const key = walletState().accessKeys[0]!;

// Wallets that cannot pay, with the error and fix command a 402 reports for each.
const problems: {
  name: string;
  state: WalletState | undefined;
  network?: "testnet";
  code: string;
  reason: string;
  command: string;
}[] = [
  {
    name: "no wallet store",
    state: undefined,
    code: "E_NOT_AUTHENTICATED",
    reason: "No wallet is logged in.",
    command: "tempo wallet login --network mainnet",
  },
  {
    name: "no account on testnet",
    state: emptyWalletState(),
    network: "testnet",
    code: "E_NOT_AUTHENTICATED",
    reason: "No wallet is logged in.",
    command: "tempo wallet login --network testnet",
  },
  {
    name: "an expired key",
    state: walletState({ accessKeys: [{ ...key, expiry: 1 }] }),
    code: "E_KEY_EXPIRED",
    reason: "The access key for this wallet on mainnet has expired.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "no key",
    state: walletState({ accessKeys: [] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    reason: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "a key without signing material",
    state: walletState({ accessKeys: [{ ...key, privateKey: undefined }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    reason: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    // Usable for wallet commands, but request cannot build a signer from it.
    name: "a key request cannot sign with",
    state: walletState({ accessKeys: [{ ...key, privateKey: undefined, keyPair: {} }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    reason: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    // Passes the local key check, but the signer rejects it when it is built.
    name: "a secp256k1 key out of range",
    state: walletState({ accessKeys: [{ ...key, privateKey: `0x${"0".repeat(64)}` }] }),
    code: "E_AUTH_REFRESH_REQUIRED",
    reason: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
  {
    name: "a P-256 handle the keystore cannot load",
    state: walletState({
      accessKeys: [
        {
          ...key,
          keyType: "p256",
          privateKey: undefined,
          handle: { kty: "EC" },
          publicKey: `0x04${"1".repeat(128)}`,
        },
      ],
    }),
    code: "E_AUTH_REFRESH_REQUIRED",
    reason: "No usable access key is configured for this wallet on mainnet.",
    command: "tempo wallet refresh --network mainnet",
  },
];

const intents = [
  { intent: "charge", offers: ["charge"] },
  { intent: "session", offers: ["session"] },
  { intent: "auto", offers: ["session", "charge"] },
] as const;

it.each(problems.flatMap((problem) => intents.map((intent) => ({ ...problem, ...intent }))))(
  "returns $code for a 402 with $name and --payment-intent $intent, without a login",
  async ({ state, network, code, reason, command, intent, offers }) => {
    await useTempHome();
    if (state) await writeWalletState(state);
    const server = await fixture({ offers: offers.map((offer) => challenge(offer, network)) });
    const io = { stdout: capture(), stderr: capture() };

    const error = await runRequest(
      [...(network ? ["-n", network] : []), "--payment-intent", intent, server.url],
      io,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code,
      exitCode: 4,
      message: `${reason} Run '${command}' before retrying.`,
      problem: { cta: { commands: [{ command }] } },
    });
    expect(server.requests()).toBe(1);
    expect(io.stdout.text()).toBe("");
    expect(createProvider).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  },
);

it.each([
  { status: 200, error: undefined },
  { status: 404, error: { code: "E_HTTP", exitCode: 3 } },
])("returns a $status body without a login", async ({ status, error }) => {
  await useTempHome();
  const server = await fixture({ status });
  const io = { stdout: capture(), stderr: capture() };

  const result = await runRequest([server.url], io).then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(result).toEqual(error ? expect.objectContaining(error) : undefined);
  expect(io.stdout.text()).toBe(`status ${status}`);
  expect(createProvider).not.toHaveBeenCalled();
});

it.each([
  { name: "TEMPO_PRIVATE_KEY", env: testPrivateKey, args: [] },
  { name: "--private-key", env: "", args: ["--private-key", testPrivateKey2] },
])("pays a 402 with $name and no login", async ({ env, args }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_PRIVATE_KEY", env);
  const server = await fixture({ offers: [challenge("charge")] });
  const io = { stdout: capture(), stderr: capture() };

  await runRequest([...args, server.url], io);

  expect(io.stdout.text()).toBe("paid");
  expect(server.requests()).toBe(2);
  expect(createProvider).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it.each([
  ...problems.map(({ name, state, network, reason, command }) => ({
    name,
    state,
    network,
    env: "",
    next: { reason, command },
  })),
  { name: "a usable key", state: walletState(), network: undefined, env: "", next: undefined },
  {
    name: "TEMPO_PRIVATE_KEY and no wallet store",
    state: undefined,
    network: undefined,
    env: testPrivateKey,
    next: undefined,
  },
])("dry-runs a 402 with $name", async ({ state, network, env, next }) => {
  await useTempHome();
  if (state) await writeWalletState(state);
  vi.stubEnv("TEMPO_PRIVATE_KEY", env);
  const server = await fixture({ offers: [challenge("charge", network)] });
  const io = { stdout: capture(), stderr: capture() };

  await runRequest([...(network ? ["-n", network] : []), "--dry-run", server.url], io);

  const output = JSON.parse(io.stdout.text()) as Record<string, unknown>;
  expect(requestDryRunOutput.parse(output)).toEqual(output);
  expect(output).toMatchObject({ payment_required: true, intent: "charge" });
  expect({ instruction: output.instruction, _next: output._next }).toEqual(
    next
      ? {
          instruction: `${next.reason} Run the next command, then rerun this request without --dry-run to pay.`,
          _next: { argv: next.command.split(" "), command: next.command },
        }
      : { instruction: undefined, _next: undefined },
  );
  expect(server.requests()).toBe(1);
  expect(createProvider).not.toHaveBeenCalled();
});

it.each(problems.filter((problem) => !problem.network))(
  "keeps the cta for $name in tempo request output",
  async ({ state, code, reason, command }) => {
    const home = await useTempHome();
    if (state) await writeWalletState(state);
    const server = await fixture({ offers: [challenge("charge")] });

    const result = await exec(process.execPath, [cliBundle("request"), "-j", server.url], {
      env: { ...process.env, HOME: home, TEMPO_PRIVATE_KEY: "", TEMPO_WALLET_NETWORK: "mainnet" },
    }).catch((error: { code: number; stdout: string; stderr: string }) => error);

    expect(result).toMatchObject({ code: 4, stdout: "" });
    expect(JSON.parse(result.stderr)).toEqual({
      code,
      message: `${reason} Run '${command}' before retrying.`,
      retryable: false,
      cta: { description: "Suggested command:", commands: [{ command }] },
    });
  },
  30_000,
);

// A zero-amount charge is authorized with a signed proof, so paying needs no funds or RPC.
function challenge(intent: "charge" | "session", network?: "testnet") {
  return Challenge.serialize(
    Challenge.from({
      id: `wallet-${intent}`,
      realm: "local",
      method: "tempo",
      intent,
      request: {
        amount: intent === "charge" ? "0" : "1",
        currency: "0x20c0000000000000000000000000000000000000",
        methodDetails: {
          chainId: network === "testnet" ? 42431 : 4217,
          ...(intent === "session" ? { sessionProtocol: "v2" } : {}),
        },
        ...(intent === "session"
          ? { recipient: "0x0000000000000000000000000000000000000001" }
          : {}),
      },
    }),
  );
}

/** Answers `status` (402 with `offers` by default) until a request carries a credential. */
async function fixture({ status = 402, offers = [] }: { status?: number; offers?: string[] }) {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.headers.authorization) {
      res.end("paid");
      return;
    }
    res.writeHead(status, offers.length > 0 ? { "www-authenticate": offers.join(", ") } : {});
    res.end(`status ${status}`);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { url: `http://127.0.0.1:${address.port}`, requests: () => requests };
}

function capture() {
  let text = "";
  return {
    write(chunk: string | Uint8Array) {
      text += Buffer.from(chunk).toString("utf8");
      return true;
    },
    text: () => text,
  };
}
