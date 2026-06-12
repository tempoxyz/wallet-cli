import { arch, platform } from "node:process";

import { version } from "../shared/constants.js";
import { chainId, networkName, tokenSymbol } from "../shared/network.js";
import { usageError } from "../shared/errors.js";
import { cleanStoredScalar, formatMicroUnits, formatUnixTimestamp } from "../shared/utils.js";
import { connect, createProvider } from "../provider.js";
import {
  emptyWalletState,
  loadWalletState,
  saveWalletState,
  type WalletState,
} from "../wallet/store.js";
import { queryCreditBalance } from "./credits.js";

export async function loginHandler(options: {
  network?: string | undefined;
  "no-browser"?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (activeAccount && walletStateMatchesNetwork(state, options.network))
    return currentWhoamiOutput({
      walletAddress: activeAccount.address,
      chain: state.chainId ?? null,
      accessKeys: state.accessKeys,
    });

  const provider = createProvider({ network: options.network, noBrowser: options["no-browser"] });
  const result = await connect(provider);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: chainId(options.network),
  };
}

export async function refreshHandler(options: { network?: string | undefined }) {
  console.error(`Auth URL: ${refreshAuthUrl(options.network)}`);
  const provider = createProvider({ network: options.network });
  const result = await connect(provider);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: chainId(options.network),
  };
}

export async function logoutHandler() {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  await saveWalletState(emptyWalletState());
  return {
    logged_in: Boolean(activeAccount),
    disconnected: Boolean(activeAccount),
    wallet: activeAccount?.address.toLowerCase() ?? null,
    message: activeAccount ? "wallet disconnected" : "not logged in",
  };
}

export async function whoamiHandler(options: {
  network?: string | undefined;
  credits?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const walletAddress = activeAccount?.address ?? null;
  const chain = state.chainId ?? null;

  if (!options.credits && !walletStateMatchesNetwork(state, options.network))
    return { ready: false };

  if (options.credits && !walletAddress)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  const credits =
    options.credits && walletAddress
      ? await queryCreditBalance({ chainId: chain, walletAddress })
      : null;

  if (options.credits) return { credits };

  return currentWhoamiOutput({ walletAddress, chain, accessKeys: state.accessKeys });
}

export async function keysHandler() {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const chain = state.chainId ?? null;

  return currentKeysOutput({
    walletAddress: activeAccount?.address ?? null,
    chain,
    accessKeys: state.accessKeys,
  });
}

export async function debugHandler(options: { network?: string | undefined }) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const chain = chainId(options.network);

  return {
    wallet_version: `${version} (local)`,
    request_version: `${version} (local)`,
    os: debugOs(),
    arch: debugArch(),
    network: networkName(chain) ?? "tempo",
    wallet: activeAccount?.address.toLowerCase() ?? null,
    wallet_type: activeAccount ? "passkey" : "unknown",
    logged_in: Boolean(activeAccount),
  };
}

export function completionsHandler() {
  return {
    supported_shells: ["bash", "zsh", "fish", "powershell", "elvish"],
  };
}

export function currentWhoamiOutput(options: {
  walletAddress: string | null;
  chain: number | null;
  accessKeys: WalletState["accessKeys"];
}) {
  return {
    ready: Boolean(options.walletAddress),
    wallet: options.walletAddress?.toLowerCase() ?? null,
    balance: emptyBalance(),
    key: currentKeyOutput({
      key: options.accessKeys[0],
      walletAddress: options.walletAddress,
      chain: options.chain,
    }),
  };
}

export function currentKeysOutput(options: {
  walletAddress: string | null;
  chain: number | null;
  accessKeys: WalletState["accessKeys"];
}) {
  const keys = options.accessKeys.flatMap((key) => {
    const output = currentKeyOutput({
      key,
      walletAddress: options.walletAddress,
      chain: options.chain,
    });
    return output ? [output] : [];
  });

  return {
    keys,
    total: keys.length,
  };
}

function currentKeyOutput(options: {
  key: WalletState["accessKeys"][number] | undefined;
  walletAddress: string | null;
  chain: number | null;
}) {
  if (!options.key) return null;
  const limit = options.key.limits[0];
  const token = limit?.token ?? "0x20c000000000000000000000b9537d11c60e8b50";
  return {
    address: options.key.address.toLowerCase(),
    chain_id: options.key.chainId,
    network: networkName(options.chain) ?? networkName(options.key.chainId) ?? "tempo",
    wallet_address: options.walletAddress?.toLowerCase() ?? null,
    symbol: tokenSymbol(token),
    token: token.toLowerCase(),
    balance: "0.000000",
    spending_limit: {
      unlimited: false,
      limit: limit ? formatMicroUnits(cleanStoredScalar(limit.limit)) : "0.000000",
      remaining: null,
      spent: null,
    },
    expires_at: formatUnixTimestamp(options.key.expiry),
  };
}

function emptyBalance() {
  return {
    total: "0.000000",
    locked: "0",
    available: "0.000000",
    active_sessions: 0,
    symbol: "USDC.e",
  };
}

function refreshAuthUrl(network: string | undefined) {
  const chain = chainId(network);
  const url = new URL("https://wallet.tempo.xyz/cli-auth");
  url.searchParams.set("network", network === "testnet" ? "testnet" : "mainnet");
  url.searchParams.set("chainId", `0x${chain.toString(16)}`);
  url.searchParams.set("code", Math.random().toString(36).slice(2, 10).toUpperCase());
  return url.toString();
}

function debugOs() {
  if (platform === "darwin") return "macos";
  return platform;
}

function debugArch() {
  if (arch === "arm64") return "aarch64";
  return arch;
}

function walletStateMatchesNetwork(state: WalletState, network: string | undefined) {
  if (!network) return true;
  const selectedChainId = chainId(network);
  return state.chainId === selectedChainId;
}
