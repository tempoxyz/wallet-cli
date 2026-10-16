import { Cli } from "incur";
import type { Address } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { option } from "../cli/describe.js";
import { balanceOptions, balanceOutput } from "../schemas/balance.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { networkError } from "../shared/errors.js";
import { networkFields, tokenAddress } from "../shared/network.js";
import { withWallet, type Wallet } from "../shared/require-wallet.js";
import {
  knownToken,
  readTokenMetadata,
  resolveTokenAddress,
  tokenMetadata,
} from "../shared/tokens.js";
import { assetBalances, fetchWalletAssets, type WalletAsset } from "../wallet/balances.js";
import {
  balanceQueryError,
  rpcChainCheck,
  statusQueryTimeout,
  tokenBalance,
} from "../wallet/key-output.js";

export default {
  command: Cli.create("balance", {
    description: "Show the wallet's token balances",
    globals: cliGlobals,
    options: balanceOptions,
    alias: globalAlias,
    output: balanceOutput,
    // Reading a balance signs nothing, so only the account is required.
    async run(context) {
      return withWallet((_, wallet) => balanceHandler(wallet, context.options), {
        requireKey: "never",
      })(context);
    },
  }),
  annotations: { balance: { ...readOnly, openWorldHint: true } },
  describe: {
    name: "balance",
    about: "Show the wallet's token balances",
    args: [
      option(
        "token",
        "--token",
        "Token address or symbol to show (default: every token the wallet holds)",
        { valueName: "TOKEN" },
      ),
    ],
  },
} satisfies WalletCommand;

/**
 * The logged-in wallet's token balances on the resolved network. With `token`, only that token's,
 * read on chain. Otherwise each token the wallet app reports, plus the network's default token
 * read on chain, which is listed even at zero. The on-chain read fails the command only when its
 * token would be missing from the output: the wallet app's balance of a token it reports is
 * shown over the chain's. Session deposits are held in escrow, not by the wallet, so the locked
 * and pending-refund amounts are `whoami`'s to report.
 */
export async function balanceHandler(
  { account, network }: Wallet,
  options: { token?: string | undefined },
) {
  const chain = network.chainId;
  const token = options.token ? resolveTokenAddress(options.token, network) : tokenAddress(chain);
  const [held, assets] = await Promise.all([
    onChainBalance(chain, token, account.address),
    options.token ? [] : fetchWalletAssets({ chain, walletAddress: account.address }),
  ]);
  const balances = assetBalances(assets, held);
  if (!balances.some((balance) => balance.token === token.toLowerCase()))
    throw networkError(balanceQueryError.message, { retryable: true });
  return { address: account.address.toLowerCase(), ...networkFields(chain), balances };
}

/**
 * The wallet's balance of `token`, read on chain in the token's decimals; `undefined` when the
 * balance or, for an unlisted token, its metadata cannot be read.
 */
async function onChainBalance(
  chain: number,
  token: Address,
  walletAddress: string,
): Promise<WalletAsset | undefined> {
  const [balance, metadata] = await Promise.all([
    tokenBalance({ chain, token, walletAddress, servesChain: rpcChainCheck() }),
    tokenMetadata(token, chain, (address) =>
      readTokenMetadata(address, chain, { timeout: statusQueryTimeout, retryCount: 0 }),
    ).catch(() => undefined),
  ]);
  if (!balance || !metadata) return undefined;
  return {
    address: token,
    balance: balance.raw,
    decimals: metadata.decimals,
    symbol: metadata.symbol,
    verified: knownToken(token, chain) !== undefined,
  };
}
