import { spawn } from "node:child_process";

import { inject } from "vitest";

import { type Localnet, localEndpointId } from "./localnet.js";
import type { LocalWallet } from "./wallet.js";

export type CliRun = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

/** The environment a CLI subprocess runs with: the wallet's HOME on the local Tempo chain. */
export function cliEnv(net: Localnet, wallet: LocalWallet, env: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: wallet.home,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? "",
    TEMPO_NO_BROWSER: "1",
    TEMPO_AUTH_URL: "http://127.0.0.1:9",
    TEMPO_RPC_URL: net.tempoUrl,
    TEMPO_WALLET_NETWORK: "testnet",
    TEMPO_DEV_CHAINS: JSON.stringify(devChains(net)),
    ...env,
  };
}

/** The `TEMPO_DEV_CHAINS` table that makes the CLI trust the local chains' tokens. */
export function devChains(net: Localnet) {
  return {
    tempo: {
      [net.tempoChainId]: {
        usdTokens: [net.ousd, net.usdc],
        fundingInputs: [net.ousd],
        // As on mainnet: USDC first (Relay and Stargate take it), then OUSD (Relay takes it).
        crossChainSources: [net.usdc, net.ousd],
        relayDepository: net.depository,
        stargate: {
          oft: net.stargate,
          token: net.usdc,
          feeWrapper: net.feeWrapper,
          endpointIds: { [net.evmChainId]: localEndpointId },
        },
        destinations: [
          {
            chainId: net.evmChainId,
            name: "local-evm",
            rpcUrl: net.evmUrl,
            usdc: { address: net.evmUsdc, name: "USDC", version: "2" },
          },
        ],
      },
    },
  };
}

/** Starts `tempo request` or `tempo wallet` from the prebuilt bundle. */
export function startCli(
  name: "request" | "wallet",
  args: readonly string[],
  env: Record<string, string>,
) {
  const child = spawn(process.execPath, [inject("cliBundles")[name], ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const done = new Promise<CliRun>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

export function runCli(
  name: "request" | "wallet",
  args: readonly string[],
  env: Record<string, string>,
) {
  return startCli(name, args, env).done;
}
