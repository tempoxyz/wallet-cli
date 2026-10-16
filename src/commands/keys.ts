import type { Provider as CoreProvider } from "accounts";
import { Cli } from "incur";
import { formatUnits, isAddress, parseUnits, toHex, type Address } from "viem";

import { destructive, readOnly, type WalletCommand } from "../cli/command.js";
import { flag, option, positional } from "../cli/describe.js";
import {
  keysOutput,
  updateAccessKeyArgs,
  updateAccessKeyOptions,
  updateAccessKeyOutput,
} from "../schemas/keys.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { explicitNetwork, networkFields, tokenAddress, type Network } from "../shared/network.js";
import { usageError } from "../shared/errors.js";
import { nextStep } from "../shared/next.js";
import { requireWalletChain, withWallet, type Wallet } from "../shared/require-wallet.js";
import { resolveTokenAddress, tokenMetadata } from "../shared/tokens.js";
import { createProvider, settleWalletStore } from "../provider.js";
import { loadWalletState, saveWalletState, type WalletState } from "../wallet/store.js";
import { accessKeyMatches } from "../wallet/access-key.js";
import {
  currentKeyOutput,
  keyTokens,
  readChainKey,
  rpcChainCheck,
  tokenBalance,
  tokenDetails,
  type TokenBalance,
} from "../wallet/key-output.js";

// Mounted groups share the root globals; declaring them types `globals` in their commands.
export default {
  command: Cli.create("keys", {
    description: "Manage access keys",
    globals: cliGlobals,
  })
    .command("list", {
      description: "List keys and their spending limits",
      options: globalOptions,
      alias: globalAlias,
      output: keysOutput,
      async run({ globals }) {
        return keysHandler(globals);
      },
    })
    .command("update", {
      description: "Update an access key spending limit",
      args: updateAccessKeyArgs,
      options: updateAccessKeyOptions,
      alias: globalAlias,
      output: updateAccessKeyOutput,
      // The wallet app approves the new limit, so an expired or unusable key can still be limited.
      run: withWallet(
        ({ args, options }, wallet) =>
          updateAccessKeyHandler(wallet, { ...options, accessKey: args.accessKey }),
        { requireKey: "never" },
      ),
    }),
  annotations: {
    keys_list: { ...readOnly, openWorldHint: true },
    keys_update: { ...destructive, idempotentHint: false, openWorldHint: true },
  },
  describe: {
    name: "keys",
    about: "Manage access keys",
    subcommands: [
      {
        name: "list",
        about:
          "List keys and their spending limits (spending_limit is deprecated; use spending_limits)",
      },
      {
        name: "update",
        about: "Update an access key spending limit",
        args: [
          positional(
            "access_key",
            "Access key address (defaults to the only key for this wallet and network)",
          ),
          option("limit", "--limit", "New remaining limit in human token units", {
            valueName: "AMOUNT",
          }),
          option("token", "--token", "Token address or symbol (defaults to current limit token)", {
            valueName: "TOKEN",
          }),
          flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
        ],
      },
    ],
  },
} satisfies WalletCommand;

/** Lists keys on every network unless `--network` or `TEMPO_WALLET_NETWORK` selects one. */
export async function keysHandler(options: { network?: string | undefined } = {}) {
  const state = await loadWalletState();
  const network = explicitNetwork(options.network);

  return await currentKeysOutput({
    walletAddress: state.accounts[state.activeAccount ?? 0]?.address ?? null,
    accessKeys: network
      ? state.accessKeys.filter((key) => key.chainId === network.chainId)
      : state.accessKeys,
  });
}

/**
 * Labels each key from its own chain and wallet, and reads it on that chain. Balances, unlisted
 * tokens, and on-chain key state are queried only for the active wallet's keys, so the RPC never
 * learns the other stored wallets or their tokens; their balances, `published`, and remaining
 * limits report `null`, and their unlisted tokens have no symbol or formatted limit.
 */
export async function currentKeysOutput(options: {
  walletAddress: string | null;
  accessKeys: WalletState["accessKeys"];
}) {
  const active = (key: WalletState["accessKeys"][number]) =>
    key.access.toLowerCase() === options.walletAddress?.toLowerCase();
  const balances = new Map<string, TokenBalance | null>();
  const servesChain = rpcChainCheck();
  const [details, chainKeys] = await Promise.all([
    tokenDetails(
      options.accessKeys.flatMap((key) => keyTokens(key, active(key))),
      servesChain,
    ),
    Promise.all(
      options.accessKeys.map((key) => (active(key) ? readChainKey(key, servesChain) : undefined)),
    ),
  ]);
  const keys = [];
  for (const [index, key] of options.accessKeys.entries()) {
    if (!active(key)) {
      keys.push(currentKeyOutput(key, undefined, details));
      continue;
    }
    const token = key.limits?.[0]?.token ?? tokenAddress(key.chainId);
    const balanceKey = `${key.chainId}:${token}`.toLowerCase();
    const balance = balances.has(balanceKey)
      ? (balances.get(balanceKey) ?? null)
      : await tokenBalance({ chain: key.chainId, token, walletAddress: key.access, servesChain });
    balances.set(balanceKey, balance);
    keys.push(currentKeyOutput(key, balance, details, chainKeys[index]));
  }

  return {
    keys,
    total: keys.length,
  };
}

type UpdateAccessKeyProvider = Pick<CoreProvider.Provider, "request">;

type AccessKeyUpdater = (options: {
  provider: UpdateAccessKeyProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  token: Address;
  limit: bigint;
}) => Promise<unknown>;

export async function updateAccessKeyHandler(
  wallet: Wallet,
  options: {
    accessKey?: string | undefined;
    limit: string;
    token?: string | undefined;
    browser?: boolean | undefined;
  },
  createUpdateProvider: (options: {
    network: Network;
    noBrowser?: boolean | undefined;
  }) => Promise<UpdateAccessKeyProvider> = createProvider,
  updateAccessKey: AccessKeyUpdater = updateAccessKeyThroughWallet,
) {
  const { account, network, state } = wallet;
  requireWalletChain(wallet);

  const selectedChainId = network.chainId;
  const selected = options.accessKey;
  if (selected !== undefined && !isAddress(selected))
    throw usageError("Invalid access key address: expected a 0x address");
  // Expired and unusable keys count: the wallet app approves the update, not the local key.
  const stored = state.accessKeys.filter((candidate) =>
    accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress: account.address }),
  );
  if (selected === undefined && stored.length > 1)
    throw usageError(
      `More than one access key is configured for the current wallet and network (${stored
        .map((candidate) => candidate.address.toLowerCase())
        .join(", ")}); pass the access key to update.`,
    );
  const key =
    selected === undefined
      ? stored[0]
      : stored.find((candidate) => candidate.address.toLowerCase() === selected.toLowerCase());
  if (!key)
    throw usageError(
      selected === undefined
        ? "No access key is configured for the current wallet and network."
        : "Selected access key is not configured for the current wallet and network.",
    );

  const { address: token, decimals } = await tokenMetadata(
    resolveTokenAddress(
      options.token ?? key.limits?.[0]?.token ?? tokenAddress(selectedChainId),
      network,
    ),
    selectedChainId,
  );
  const limit = parseLimit(options.limit, decimals);
  const walletAddress = account.address as Address;
  const accessKeyAddress = key.address as Address;
  const provider = await createUpdateProvider({ network, noBrowser: options.browser === false });

  await updateAccessKey({
    provider,
    walletAddress,
    accessKeyAddress,
    chainId: selectedChainId,
    token,
    limit,
  });

  // For an unpublished key the SDK saves the wallet's replacement authorization in the
  // background, so reload the store once it lands and change only the limit.
  await settleWalletStore();
  const current = await loadWalletState();
  const accessKeys = current.accessKeys.map((candidate) => {
    if (
      candidate.address.toLowerCase() !== accessKeyAddress.toLowerCase() ||
      !accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress })
    )
      return candidate;
    const storedLimits = candidate.limits ?? [];
    const existing = storedLimits.findIndex((item) => item.token.toLowerCase() === token);
    const nextLimit = `${limit}#__bigint`;
    const limits =
      existing === -1
        ? [...storedLimits, { token, limit: nextLimit }]
        : storedLimits.map((item, index) =>
            index === existing ? { ...item, limit: nextLimit } : item,
          );
    return { ...candidate, limits };
  });
  await saveWalletState({ ...current, accessKeys });

  return {
    status: "success" as const,
    wallet: walletAddress.toLowerCase(),
    access_key: accessKeyAddress.toLowerCase(),
    ...networkFields(selectedChainId),
    token,
    limit: formatUnits(limit, decimals),
    ...nextStep("Run the next command to confirm the new limit.", ["wallet", "keys", "list"], {
      network,
    }),
  };
}

async function updateAccessKeyThroughWallet(options: {
  provider: UpdateAccessKeyProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  token: Address;
  limit: bigint;
}) {
  await options.provider.request({
    method: "wallet_updateAccessKey",
    params: [
      {
        address: options.walletAddress,
        accessKeyAddress: options.accessKeyAddress,
        chainId: toHex(options.chainId),
        limits: [{ token: options.token, limit: toHex(options.limit) }],
      },
    ],
  });
}

/** Parses a limit in the token's decimals; zero is allowed and leaves the key unable to spend it. */
function parseLimit(value: string, decimals: number) {
  const fraction = value.split(".")[1] ?? "";
  if (!/^\d+(?:\.\d+)?$/.test(value) || fraction.length > decimals)
    throw usageError(
      `Invalid limit: expected a non-negative token amount with at most ${decimals} decimals`,
    );
  return parseUnits(value, decimals);
}
