import { Cli } from "incur";
import type { Address } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
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
} satisfies WalletCommand;

/**
 * The logged-in wallet's token balances on the resolved network. With `token`, only that token's,
 * read on chain. Otherwise MACH and each token the wallet app reports, plus the network's default
 * token read on chain. MACH and the default token are listed even at zero. The default-token read
 * fails the command only when its token would be missing: the app's balance takes precedence for
 * tokens it reports. Session deposits are held in escrow, so the locked
 * and pending-refund amounts are `whoami`'s to report.
 */
export async function balanceHandler(
  { account, network }: Wallet,
  options: { token?: string | undefined },
) {
  const chain = network.chainId;
  const token = options.token ? resolveTokenAddress(options.token, network) : tokenAddress(chain);
  const servesChain = rpcChainCheck();
  const [held, assets] = await Promise.all([
    onChainBalance(chain, token, account.address, servesChain),
    options.token ? [] : fetchWalletAssets({ chain, walletAddress: account.address, servesChain }),
  ]);
  const balances = assetBalances(assets, held);
  if (!balances.some((balance) => balance.token === token.toLowerCase()))
    throw networkError(balanceQueryError.message, { retryable: true });
  return { wallet: account.address.toLowerCase(), ...networkFields(chain), balances };
}

/**
 * The wallet's balance of `token`, read on chain in the token's decimals; `undefined` when the
 * balance or, for an unlisted token, its metadata cannot be read.
 */
async function onChainBalance(
  chain: number,
  token: Address,
  walletAddress: string,
  servesChain: (chain: number) => Promise<boolean>,
): Promise<WalletAsset | undefined> {
  const [balance, metadata] = await Promise.all([
    tokenBalance({ chain, token, walletAddress, servesChain }),
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
