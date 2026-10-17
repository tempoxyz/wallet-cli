import { formatUnits, isAddress, toHex, zeroAddress } from "viem";
import type { z } from "incur";
import { Actions } from "viem/tempo";

import type { CtaError } from "../../cli/incur-compat.js";
import type { sendSuccessOutput } from "../../schemas/send.js";
import {
  commandError,
  networkError,
  paymentOutcomeUnknownError,
  usageError,
} from "../../shared/errors.js";
import {
  createTempoPublicClient,
  networkFields,
  networkName,
  storedChainId,
  type Network,
} from "../../shared/network.js";
import { continuationCommand, nextStep } from "../../shared/next.js";
import { confirm } from "../../shared/process.js";
import type { Wallet } from "../../shared/require-wallet.js";
import {
  resolveTokenAddress,
  tokenLabel,
  tokenMetadata,
  tokenSymbol,
} from "../../shared/tokens.js";
import { getRecord, parseTokenAmount, stringValue } from "../../shared/utils.js";
import { createProvider, requireChain, requireSender } from "../../provider.js";
import {
  idempotencyKey,
  recordedSend,
  submitTransaction,
  txStatus,
  type TxSend,
  type TxState,
} from "../tx.js";

// Dry-run lookups are advisory, so a stalled RPC must not hold up the review.
const lookupTimeout = 3_000;
// Gas prices are in attodollars (10^-18 USD); fee tokens charge in 10^-6 USD base units.
const attodollarsPerFeeUnit = 10n ** 12n;
const feeTokenDecimals = 6;

type TransferDependencies = {
  getBalance: (options: {
    account: `0x${string}`;
    decimals: number;
    token: `0x${string}`;
  }) => Promise<bigint>;
  /** The network fee in fee-token base units. */
  estimateFee: (options: {
    account: `0x${string}`;
    amount: bigint;
    feeToken: `0x${string}` | undefined;
    to: `0x${string}`;
    token: `0x${string}`;
  }) => Promise<bigint>;
  /** The account's default fee token, or `null` when it has none. */
  getUserFeeToken: (account: `0x${string}`) => Promise<`0x${string}` | null>;
  confirm: (question: string) => Promise<boolean>;
  submit: (options: {
    call: { data: `0x${string}`; to: `0x${string}` };
    feeToken: `0x${string}` | undefined;
    /** The logged-in wallet the command checked; the send goes out from it or not at all. */
    from: string;
    network: Network;
  }) => Promise<string>;
  /** Reads a transaction's state on chain, for a send replayed from its idempotency key. */
  getTxStatus: (txHash: string) => Promise<TxState>;
};

/**
 * Sends a token transfer only once it is confirmed: `--yes` confirms it, and an `interactive` run
 * without `--yes` asks on the terminal. Any other run without `--yes` sends nothing; its dry run
 * reports the fee estimate and balance and continues with `--yes`. A reviewed fee token (the
 * dry run's `_next`, or the prompt) is pinned in the transaction, so the fee is charged in it.
 * With `--idempotency-key`, a transfer is sent at most once per key; see `recordedSend`.
 */
export async function transferTokens(
  wallet: Wallet,
  options: {
    args: { amount?: string | undefined; token?: string | undefined; to?: string | undefined };
    options: {
      address?: string | undefined;
      "dry-run"?: boolean | undefined;
      "fee-token"?: string | undefined;
      "idempotency-key"?: string | undefined;
      yes?: boolean | undefined;
    };
    /** Whether a person answers at the terminal (stdin and stdout); only then is it prompted. */
    interactive?: boolean | undefined;
    /**
     * The refusal to throw instead of sending, for a keyed send whose missing access key was not
     * checked up front because a replay needs none.
     */
    keyRequired?: CtaError | undefined;
  },
  dependencies: Partial<TransferDependencies> = {},
) {
  const { args } = options;
  if (args.amount === undefined || args.token === undefined || args.to === undefined) {
    const missing = (["amount", "token", "to"] as const).filter((name) => args[name] === undefined);
    throw usageError(
      `missing ${missing.map((name) => `<${name}>`).join(", ")}; usage: tempo wallet send <amount> <token> <to>`,
    );
  }
  if (!isAddress(args.to))
    throw usageError("Invalid recipient address: expected a full 0x address");
  if (args.to.toLowerCase() === zeroAddress)
    throw usageError("Invalid recipient address: cannot transfer to the zero address");
  // The transfer is sent from the logged-in wallet, so a review must not describe another one.
  const from = wallet.account.address.toLowerCase() as `0x${string}`;
  if (options.options.address !== undefined && options.options.address.toLowerCase() !== from)
    throw usageError("--address must match the logged-in wallet");
  const key = idempotencyKey(options.options["idempotency-key"]);

  const { network } = wallet;
  const requestedToken = resolveTokenAddress(args.token, network);
  const feeToken = options.options["fee-token"]
    ? resolveTokenAddress(options.options["fee-token"], network, "fee token")
    : undefined;
  const refusal = options.options["dry-run"] ? undefined : transferNetworkRefusal(wallet);
  if (refusal) return refusal;
  // An unlisted token's decimals are read on chain.
  const token = await tokenMetadata(requestedToken, network.chainId);
  const amount = parseTokenAmount(args.amount, token.decimals);

  const to = args.to.toLowerCase() as `0x${string}`;
  const outputBase = {
    ...networkFields(network.chainId),
    amount: args.amount,
    symbol: token.symbol,
    token: token.address,
    to,
    from,
  };

  const runtime = { ...defaultDependencies(network), ...dependencies };
  // Without --fee-token, the protocol charges the account's default fee token, else the
  // transferred token; `null` when the default cannot be read.
  const resolveFeeToken = async () =>
    feeToken ??
    runtime.getUserFeeToken(from).then(
      (userToken) => userToken ?? token.address,
      () => null,
    );

  if (options.options["dry-run"]) {
    const readBalance = (balanceToken: `0x${string}`, decimals: number) =>
      runtime.getBalance({ account: from, decimals, token: balanceToken }).catch(() => null);
    const resolvedFeeToken = resolveFeeToken();
    const [balance, fee, paidFeeToken, otherFeeTokenBalance] = await Promise.all([
      readBalance(token.address, token.decimals),
      runtime
        .estimateFee({ account: from, amount, feeToken, to, token: token.address })
        .catch(() => null),
      resolvedFeeToken,
      // Another fee token's balance must cover the fee on its own.
      resolvedFeeToken.then((paid) =>
        paid && paid !== token.address ? readBalance(paid, feeTokenDecimals) : null,
      ),
    ]);
    const sameToken = paidFeeToken === token.address;
    const feeTokenBalance = sameToken ? balance : otherFeeTokenBalance;
    return {
      status: "dry_run" as const,
      ...outputBase,
      fee_token: paidFeeToken,
      fee_estimate: fee === null ? null : formatUnits(fee, feeTokenDecimals),
      balance: balance === null ? null : formatUnits(balance, token.decimals),
      fee_token_balance:
        feeTokenBalance === null
          ? null
          : formatUnits(feeTokenBalance, sameToken ? token.decimals : feeTokenDecimals),
      sufficient_balance: sufficientBalance({ amount, balance, fee, feeTokenBalance, sameToken }),
      ...nextStep(
        `Review the transfer, then run the next command to send ${args.amount} ${tokenLabel(token)} to ${to}.`,
        [
          "wallet",
          "send",
          args.amount,
          token.address,
          to,
          // The reviewed fee token is pinned, so the send cannot charge another one.
          ...(paidFeeToken ? ["--fee-token", paidFeeToken] : []),
          ...(options.options.address ? ["--address", options.options.address] : []),
          ...(key !== undefined ? ["--idempotency-key", key] : []),
          "--yes",
        ],
        { network },
      ),
    };
  }
  const tx: TxSend = {
    label: "Transfer",
    network,
    idempotency:
      key === undefined
        ? undefined
        : {
            key,
            wallet: from,
            request: {
              // `send` and `transfer` make the same request, and keys recorded before `send`
              // existed name `transfer`, so a retry under either name replays them.
              command: "transfer",
              amount: amount.toString(),
              token: token.address,
              to,
              fee_token: feeToken ?? null,
            },
            getTxStatus: runtime.getTxStatus,
          },
  };
  // A replay sends nothing, so it needs no confirmation or access key.
  const recorded = await recordedSend<z.infer<typeof sendSuccessOutput>>(tx);
  if (recorded) return recorded;
  if (options.keyRequired) throw options.keyRequired;

  let sendFeeToken = feeToken;
  if (!options.options.yes) {
    if (!options.interactive)
      throw usageError("Transfer not sent: review it with --dry-run, then pass --yes");
    const paidFeeToken = await resolveFeeToken();
    if (!paidFeeToken)
      throw networkError(
        "Transfer not sent: unable to read the account's default fee token. Pass --fee-token to choose one, or retry.",
      );
    const feeTokenSymbol =
      paidFeeToken === token.address
        ? token.symbol
        : (tokenSymbol(paidFeeToken, network.chainId) ?? null);
    const confirmed = await runtime.confirm(
      [
        `Send ${args.amount} ${tokenWithAddress(token.symbol, token.address)}`,
        `  to:        ${to}`,
        `  network:   ${network.name} (chain ${network.chainId})`,
        `  fee token: ${tokenWithAddress(feeTokenSymbol, paidFeeToken)}`,
        "Send this transfer?",
      ].join("\n"),
    );
    if (!confirmed) throw usageError("Transfer not sent: not confirmed at the prompt");
    sendFeeToken = paidFeeToken;
  }

  const call = Actions.token.transfer.call({ amount, token: token.address, to });
  return submitTransaction(
    tx,
    () => runtime.submit({ call, feeToken: sendFeeToken, from: wallet.account.address, network }),
    (txHash) => ({ status: "success" as const, tx_hash: txHash, ...outputBase }),
  );
}

/**
 * The refusal of a token transfer on a network other than the one the wallet is logged in on. The
 * provider falls back to wallet-app approval, on the logged-in chain, whenever no access key can
 * sign the call locally, so a transfer is sent only on that chain, with or without a key there.
 */
export function transferNetworkRefusal({ network, state }: Pick<Wallet, "network" | "state">) {
  const walletChainId = storedChainId(state);
  if (walletChainId === network.chainId) return undefined;
  const command = continuationCommand(["wallet", "login"], network);
  return commandError(
    "E_USAGE",
    `Transfer not sent: wallet is logged in on ${networkName(walletChainId)}, not ${networkName(network.chainId)}; log in with '${command}', then rerun the transfer.`,
    command,
  );
}

function tokenWithAddress(symbol: string | null, address: string) {
  return symbol ? `${symbol} (${address})` : address;
}

/**
 * Whether the transferred token's `balance` covers the amount and the fee token's balance covers
 * the fee (both, when they are the same token). `false` on any known shortfall, else `null` when
 * the fee or a needed balance is unknown.
 */
function sufficientBalance(options: {
  amount: bigint;
  balance: bigint | null;
  fee: bigint | null;
  /** `null` when the balance, or the fee token itself, is unknown. */
  feeTokenBalance: bigint | null;
  sameToken: boolean;
}) {
  const { amount, balance, fee, feeTokenBalance, sameToken } = options;
  if (balance !== null && balance < amount) return false;
  if (fee !== null && feeTokenBalance !== null && feeTokenBalance < (sameToken ? amount : 0n) + fee)
    return false;
  if (balance === null || fee === null || feeTokenBalance === null) return null;
  return true;
}

function defaultDependencies(network: Network): TransferDependencies {
  const client = createTempoPublicClient(network.chainId, {
    timeout: lookupTimeout,
    retryCount: 0,
  });
  return {
    async getBalance(options) {
      return (await Actions.token.getBalance(client, options)).amount;
    },
    async estimateFee({ feeToken, ...transfer }) {
      const [gas, gasPrice] = await Promise.all([
        Actions.token.transfer.estimateGas(client, {
          ...transfer,
          ...(feeToken ? { feeToken } : {}),
        }),
        client.getGasPrice(),
      ]);
      // The protocol rounds the fee up to a whole base unit.
      return (gas * gasPrice + attodollarsPerFeeUnit - 1n) / attodollarsPerFeeUnit;
    },
    async getUserFeeToken(account) {
      const userToken = await Actions.fee.getUserToken(client, { account });
      return userToken ? (userToken.address.toLowerCase() as `0x${string}`) : null;
    },
    confirm,
    async submit({ call, feeToken, from, network }) {
      const provider = await createProvider({ network });
      requireChain(provider, network);
      // Without a chain ID the provider sends on the wallet's saved chain, not the reviewed one.
      const receipt = await provider.request({
        method: "eth_sendTransactionSync",
        params: [
          {
            from: requireSender(provider, from),
            calls: [call],
            chainId: toHex(network.chainId),
            ...(feeToken ? { feeToken } : {}),
          },
        ],
      });
      const record = getRecord(receipt);
      const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
      if (!txHash)
        throw paymentOutcomeUnknownError(
          "Transfer submitted but receipt did not include a transaction hash; check the wallet balance before retrying.",
        );
      return txHash;
    },
    async getTxStatus(txHash) {
      return (await txStatus(txHash, network)).status;
    },
  };
}
