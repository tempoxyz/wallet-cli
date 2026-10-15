import { Cli } from "incur";
import { isAddress, type Address } from "viem";

import { destructive, type WalletCommand } from "../cli/command.js";
import { flag, positional } from "../cli/describe.js";
import { revokeArgs, revokeOptions, revokeOutput } from "../schemas/revoke.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { networkFields, type Network } from "../shared/network.js";
import { commandError, networkError, usageError, type CommandContext } from "../shared/errors.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import { requireWalletChain, withWallet, type Wallet } from "../shared/require-wallet.js";
import { canPrompt, confirm as confirmPrompt } from "../shared/process.js";
import { createProvider, settleWalletStore } from "../provider.js";
import { saveWalletState, type WalletState } from "../wallet/store.js";
import { accessKeyMatches } from "../wallet/access-key.js";
import { currentKeyOutput, keyTokens, tokenDetails } from "../wallet/key-output.js";
import {
  readAccessKeyOnChain,
  revokeThroughWallet,
  type OnChainKeyReader,
  type RevokeProvider,
} from "../wallet/revocation.js";

export default {
  command: Cli.create("revoke", {
    description: "Revoke an access key",
    globals: cliGlobals,
    args: revokeArgs,
    options: revokeOptions,
    alias: globalAlias,
    output: revokeOutput,
    // The wallet app signs the revocation, so the local access key need not be usable.
    // Piped stdin cannot answer the prompt, so such a run confirms like an agent's, with --yes.
    run: withWallet(
      (context, wallet) =>
        revokeHandler(wallet, context.args, context.options, {
          ...context,
          agent: !canPrompt(context.agent),
        }),
      { requireKey: "never" },
    ),
  }),
  annotations: { revoke: { ...destructive, idempotentHint: true, openWorldHint: true } },
  describe: {
    name: "revoke",
    about: "Revoke an access key",
    args: [
      positional("access_key", "Access key address to revoke (0x...)"),
      flag("dry_run", "--dry-run", "Show the key that would be revoked without revoking it"),
      flag("yes", "--yes", "Revoke without a confirmation prompt"),
      flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
    ],
  },
} satisfies WalletCommand;

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
    walletKeys.includes(candidate) && candidate.address.toLowerCase() === output.access_key;
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

  const provider = await (dependencies.createProvider ?? createProvider)({
    network,
    noBrowser: options.browser === false,
  });
  const revoked = await revokeThroughWallet({ provider, readKey, stored, target });
  // The SDK drops the key from the store once the wallet app returns, even when the chain does
  // not show it revoked; let that write land, then restore the key from the snapshot.
  await settleWalletStore();
  if (!revoked) {
    if (stored) await saveWalletState(state);
    throw networkError(
      `The wallet app returned, but access key ${output.access_key} is not revoked on ${network.name}, so nothing was removed locally. Rerun the command to retry.`,
    );
  }

  const accessKeys = state.accessKeys.filter((candidate) => !isRevoked(candidate));
  const localKeyRemoved = accessKeys.length !== state.accessKeys.length;
  if (localKeyRemoved) await saveWalletState({ ...state, accessKeys });

  return {
    ...output,
    status: "success" as const,
    local_key_removed: localKeyRemoved,
  };
}
