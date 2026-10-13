import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { useTempHome, walletState, writeWalletState } from "./helpers.js";

const execFileAsync = promisify(execFile);

const mainnet = { chain_id: 4217, network: "tempo" };
const testnet = { chain_id: 42431, network: "tempo-moderato" };

it.each([
  "whoami -n testnet",
  "-n testnet whoami",
  "whoami --network=testnet",
  "--network moderato whoami",
  "debug --network tempo-moderato",
  "sessions list -n testnet",
  "-n testnet sessions list",
  "-n testnet sessions",
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

async function walletJson(args: string[], network?: string | undefined) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliBundle("wallet"), ...args, "--format", "json"],
    {
      env: {
        ...process.env,
        // Keep balance and asset lookups local so a logged-in whoami fails fast.
        TEMPO_AUTH_URL: "http://127.0.0.1:9",
        TEMPO_RPC_URL: "http://127.0.0.1:9",
        TEMPO_WALLET_NETWORK: network,
      },
    },
  );
  return JSON.parse(stdout) as unknown;
}
