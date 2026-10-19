import { readFileSync } from "node:fs";

import { walletError } from "./errors.js";
import { pathusd, usdce } from "viem/tokens";

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
};

export const version = process.env.TEMPO_WALLET_VERSION ?? packageVersion();
export const usdcToken = usdce(4217).address;
export const moderatoToken = pathusd(42431).address;
export const mainnetEscrow = "0x33b901018174ddabe4841042ab76ba85d4e24f25" as const;
export const moderatoEscrow = "0xe1c4d3dce17bc111181ddf716f75bae49e61a336" as const;
export const defaultGracePeriodSeconds = 900;
export const logQueryBlockRange = 50_000n;
export const logScanDepth = 100_000n;
export const logHeadMargin = 10n;

/**
 * The incur and accounts SDK versions the CLI runs on: set by the bundler for a release build,
 * else as package.json pins them. `null` when neither is available.
 */
export function sdkVersions() {
  return {
    incur: process.env.TEMPO_WALLET_INCUR_VERSION ?? dependencyVersion("incur"),
    accounts: process.env.TEMPO_WALLET_ACCOUNTS_VERSION ?? dependencyVersion("accounts"),
  };
}

function dependencyVersion(name: string) {
  try {
    return readPackageJson().dependencies?.[name] ?? null;
  } catch {
    return null;
  }
}

function readPackageJson() {
  return JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as PackageJson;
}

function packageVersion() {
  const packageJson = readPackageJson();

  if (!packageJson.version)
    throw walletError({ code: "E_RUNTIME", message: "package.json is missing version" });

  return packageJson.version;
}

export const escrowAbi = [
  {
    type: "function",
    name: "getChannel",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "finalized", type: "bool" },
      { name: "closeRequestedAt", type: "uint64" },
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "authorizedSigner", type: "address" },
      { name: "deposit", type: "uint128" },
      { name: "settled", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "CLOSE_GRACE_PERIOD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "period", type: "uint64" }],
  },
  {
    type: "function",
    name: "topUp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "channelId", type: "bytes32" },
      { name: "additionalDeposit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestClose",
    stateMutability: "nonpayable",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [],
  },
] as const;
