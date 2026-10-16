import type { Provider as CoreProvider } from "accounts";
import { Cli, type z } from "incur";
import { formatUnits, isAddress, parseUnits, toHex, type Address } from "viem";

import { destructive, readOnly, type WalletCommand } from "../cli/command.js";
import { flag, option, positional } from "../cli/describe.js";
import {
  keysOutput,
  revokeArgs,
  revokeOptions,
  revokeOutput,
  updateAccessKeyArgs,
  updateAccessKeyOptions,
  updateAccessKeyOutput,
} from "../schemas/keys.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { explicitNetwork, networkFields, tokenAddress, type Network } from "../shared/network.js";
import { commandError, networkError, usageError, type CommandContext } from "../shared/errors.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import { requireWalletChain, withWallet, type Wallet } from "../shared/require-wallet.js";
import { canPrompt, confirm as confirmPrompt } from "../shared/process.js";
import { resolveTokenAddress, tokenMetadata } from "../shared/tokens.js";
import { createProvider, createRevokeProvider, settleWalletStore } from "../provider.js";
import {
  loadWalletState,
  saveWalletState,
  updateWalletState,
  type WalletState,
} from "../wallet/store.js";
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
import {
  readAccessKeyOnChain,
  revokeThroughWallet,
  type OnChainKeyReader,
  type RevokeProvider,
} from "../wallet/revocation.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type RevokeContext = CommandContext & {
  args: z.output<typeof revokeArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof revokeOptions>;
};

/** `keys revoke`, which the deprecated top-level `revoke` also runs. */
export const revokeCommand = {
  description: "Revoke an access key",
  args: revokeArgs,
  options: revokeOptions,
  alias: globalAlias,
  output: revokeOutput,
  // The wallet app signs the revocation, so the local access key need not be usable.
  // Piped stdin cannot answer the prompt, so such a run confirms like an agent's, with --yes.
  run: withWallet(
    (context: RevokeContext, wallet) =>
      revokeHandler(wallet, context.args, context.options, {
        ...context,
        agent: !canPrompt(context.agent),
      }),
    { requireKey: "never" },
  ),
};

export const revokeAnnotations = { ...destructive, idempotentHint: true, openWorldHint: true };

export const revokeDescribe = {
  name: "revoke",
  about: "Revoke an access key",
  args: [
    positional("access_key", "Access key address to revoke (0x...)"),
    flag("dry_run", "--dry-run", "Show the key that would be revoked without revoking it"),
    flag("yes", "--yes", "Revoke without a confirmation prompt"),
    flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
  ],
};

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
    })
    .command("revoke", revokeCommand),
  annotations: {
    keys_list: { ...readOnly, openWorldHint: true },
    keys_update: { ...destructive, idempotentHint: false, openWorldHint: true },
    keys_revoke: revokeAnnotations,
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
      revokeDescribe,
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

/**
 * Revokes an access key of the logged-in wallet on its network through the wallet app, after
 * confirmation: a prompt on interactive runs, `--yes` on agent runs. The key must be stored for
 * the wallet or, when created elsewhere, authorized for it on-chain. The command succeeds only
 * once the chain shows the key revoked.
 */
export async function revokeHandler(
  wallet: Wallet,
  args: { accessKey: string },
  options: {
    browser?: boolean | undefined;
    "dry-run"?: boolean | undefined;
    yes?: boolean | undefined;
  },
  context: CommandContext,
  dependencies: {
    confirm?: (question: string) => Promise<boolean>;
    createProvider?: (options: {
      network: Network;
      noBrowser?: boolean | undefined;
    }) => Promise<RevokeProvider>;
    readKey?: OnChainKeyReader;
  } = {},
) {
  if (!isAddress(args.accessKey))
    throw usageError("Invalid access key address: expected a 0x address");

  const { account, network, state } = wallet;
  requireWalletChain(wallet);

  const accessKeyAddress = args.accessKey as Address;
  const walletAddress = account.address as Address;
  const selectedChainId = network.chainId;
  const readKey = dependencies.readKey ?? readAccessKeyOnChain;
  const target = { chainId: selectedChainId, walletAddress, accessKeyAddress };
  const output = {
    access_key: accessKeyAddress.toLowerCase(),
    wallet: walletAddress.toLowerCase(),
    ...networkFields(selectedChainId),
  };
  const walletKeys = state.accessKeys.filter((candidate) =>
    accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress }),
  );
  const isRevoked = (candidate: WalletState["accessKeys"][number]) =>
    accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress }) &&
    candidate.address.toLowerCase() === output.access_key;
  const stored = walletKeys.find(isRevoked);
  // A key created on another device is not stored here, but the chain shows whether it belongs
  // to the wallet. A mistyped address is neither stored nor authorized.
  const onChain = stored ? undefined : await readKey(target);
  const key =
    stored ??
    (onChain?.status === "published"
      ? {
          address: output.access_key,
          access: output.wallet,
          chainId: selectedChainId,
          expiry: onChain.expiry,
        }
      : undefined);
  if (!key)
    throw usageError(
      `Access key ${output.access_key} is not stored for wallet ${output.wallet} on ${network.name} or authorized for it on-chain. ${
        walletKeys.length
          ? `Its stored keys on ${network.name}: ${walletKeys.map((candidate) => candidate.address.toLowerCase()).join(", ")}.`
          : `It has no stored keys on ${network.name}.`
      }`,
    );

  const argv = [
    "wallet",
    "keys",
    "revoke",
    output.access_key,
    "--yes",
    ...(options.browser === false ? ["--no-browser"] : []),
  ];
  if (options["dry-run"])
    return {
      ...output,
      status: "dry_run" as const,
      local_key_removed: false,
      key: currentKeyOutput(key, undefined, await tokenDetails(keyTokens(key))),
      ...nextStep(
        "Review the key, then run the next command to revoke it on-chain. Revocation cannot be undone.",
        argv,
        { network },
      ),
    };

  if (!options.yes) {
    const command = continuationCommand(argv, network);
    if (context.agent)
      return context.error(
        commandError(
          "E_USAGE",
          `Revocation cannot be undone, so it needs confirmation. Review the key with --dry-run, then run '${command}'.`,
          command,
        ),
      );
    const confirm = dependencies.confirm ?? confirmPrompt;
    if (
      !(await confirm(
        `Revoke access key ${output.access_key} for wallet ${output.wallet} on ${network.name}? This cannot be undone.`,
      ))
    )
      throw usageError("Access key not revoked.");
  }

  const provider = await (dependencies.createProvider ?? createRevokeProvider)({
    network,
    noBrowser: options.browser === false,
  });
  const revoked = await revokeThroughWallet({ provider, readKey, stored, target });
  if (!revoked)
    throw networkError(
      `The wallet app returned, but access key ${output.access_key} is not revoked on ${network.name}, so nothing was removed locally. Rerun the command to retry.`,
    );

  // The provider never writes the store, so only the key changes, in the store as it is now: a
  // login another process made since the command read it, as while the prompt or the wallet app
  // waited, survives.
  if (stored)
    await updateWalletState((current) => ({
      ...current,
      accessKeys: current.accessKeys.filter((candidate) => !isRevoked(candidate)),
    }));

  return {
    ...output,
    status: "success" as const,
    local_key_removed: stored !== undefined,
  };
}
