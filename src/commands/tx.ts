import { Cli, Errors } from "incur";
import { formatUnits, TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { option, positional } from "../cli/describe.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { txStatusArgs, txStatusOutput } from "../schemas/tx.js";
import { commandError, networkError, usageError } from "../shared/errors.js";
import {
  createTempoPublicClient,
  networkFields,
  resolveNetwork,
  type Network,
} from "../shared/network.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import { escapeInvisible, getRecord, nowSeconds } from "../shared/utils.js";
import {
  createIdempotencyRecord,
  deleteIdempotencyRecord,
  loadIdempotencyRecord,
  pruneIdempotencyRecords,
  saveIdempotencyRecord,
  type IdempotencyRecord,
} from "../wallet/idempotency.js";

// Mounted groups share the root globals; declaring them types `globals` in their commands.
export default {
  command: Cli.create("tx", {
    description: "Inspect transactions",
    globals: cliGlobals,
  }).command("status", {
    description: "Show a transaction's status on chain",
    args: txStatusArgs,
    options: globalOptions,
    alias: globalAlias,
    output: txStatusOutput,
    async run({ args, globals }) {
      return txStatus(args.txHash, await resolveNetwork(globals.network));
    },
  }),
  annotations: { tx_status: { ...readOnly, openWorldHint: true } },
  describe: {
    name: "tx",
    about: "Inspect transactions",
    subcommands: [
      {
        name: "status",
        about: "Show a transaction's status on chain",
        args: [positional("tx_hash", "Transaction hash (0x...)")],
      },
    ],
  },
} satisfies WalletCommand;

/** The `--describe` entry of `--idempotency-key`, on the commands that send a transaction. */
export const idempotencyKeyArg = option(
  "idempotency_key",
  "--idempotency-key",
  "Send at most once per key for this wallet and network; a retry with the same key returns the recorded result instead of sending again",
  { valueName: "KEY" },
);

/** A transaction's state on chain, as `tx status` reports it. */
export type TxState = "success" | "reverted" | "pending" | "not_found";

/** `tx status` output; the block, sender, recipient, and fee are `null` until known. */
type TxStatus = {
  tx_hash: string;
  chain_id: number;
  network: string;
  status: TxState;
  block_number: number | null;
  from: string | null;
  to: string | null;
  /** The fee paid, in `fee_token` units. */
  fee: string | null;
  fee_token: string | null;
} & Partial<ReturnType<typeof nextStep>>;

// Each status read is bounded, so a stalled RPC cannot hold up the command.
const statusTimeout = 5_000;
// Gas prices are in attodollars (10^-18 USD); fee tokens charge in 10^-6 USD base units.
const attodollarsPerFeeUnit = 10n ** 12n;
const feeTokenDecimals = 6;
const txHashPattern = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads transaction `txHash` on `network`: its receipt once a block includes it, else whether the
 * node still holds it pending. Each RPC request stops after five seconds; a failed read is a
 * retryable `E_NETWORK`. A pending transaction's `_next` reruns this until it is no longer pending.
 */
export async function txStatus(txHash: string, network: Network): Promise<TxStatus> {
  if (!txHashPattern.test(txHash))
    throw usageError("Invalid transaction hash: expected 0x followed by 64 hex characters");
  const hash = txHash.toLowerCase() as `0x${string}`;
  const client = createTempoPublicClient(network.chainId, {
    timeout: statusTimeout,
    retryCount: 0,
  });
  const output = (status: TxState) => ({
    tx_hash: hash,
    ...networkFields(network.chainId),
    status,
    block_number: null,
    from: null,
    to: null,
    fee: null,
    fee_token: null,
  });
  const pending = (from: string, to: string | null | undefined): TxStatus => ({
    ...output("pending"),
    from: from.toLowerCase(),
    to: to?.toLowerCase() ?? null,
    ...txStatusNext(hash, network),
  });
  try {
    const receipt = await client
      .getTransactionReceipt({ hash })
      .catch(unless(TransactionReceiptNotFoundError));
    if (receipt?.status === "pending") return pending(receipt.from, receipt.to);
    if (receipt)
      return {
        ...output(receipt.status),
        block_number: Number(receipt.blockNumber),
        from: receipt.from.toLowerCase(),
        to: receipt.to?.toLowerCase() ?? null,
        // The protocol rounds the fee up to a whole base unit.
        fee: formatUnits(
          (receipt.gasUsed * receipt.effectiveGasPrice + attodollarsPerFeeUnit - 1n) /
            attodollarsPerFeeUnit,
          feeTokenDecimals,
        ),
        fee_token: receipt.feeToken?.toLowerCase() ?? null,
      };
    const transaction = await client
      .getTransaction({ hash })
      .catch(unless(TransactionNotFoundError));
    if (transaction) return pending(transaction.from, transaction.to);
    return output("not_found");
  } catch (error) {
    const reason =
      error instanceof Error
        ? ((error as { shortMessage?: string }).shortMessage ?? error.message)
        : String(error);
    throw networkError(`Unable to read transaction ${hash} on ${network.name}: ${reason}`, {
      retryable: true,
    });
  }
}

/** The `_next` that polls a pending transaction with `tx status`. */
function txStatusNext(txHash: string, network: Network) {
  return nextStep(
    "The transaction is pending. Rerun the next command until its status is no longer pending.",
    ["wallet", "tx", "status", txHash],
    { network, until: '.status != "pending"', pollIntervalSeconds: 1 },
  );
}

/** Rethrows any error that is not an instance of `type`, which it treats as `undefined`. */
function unless(type: new (...args: never[]) => Error) {
  return (error: unknown) => {
    if (error instanceof type) return undefined;
    throw error;
  };
}

/**
 * `E_PAYMENT_OUTCOME_UNKNOWN` for a transaction that may have been sent, shaped for incur's
 * `c.error`. With the transaction's hash, the message names it and the `cta` reads its status with
 * `tx status`; without one, the `cta` shows the wallet's balances.
 */
export function txOutcomeUnknown(message: string, network: Network, txHash?: string | undefined) {
  if (txHash === undefined)
    return commandError(
      "E_PAYMENT_OUTCOME_UNKNOWN",
      message,
      continuationCommand(["wallet", "whoami"], network),
    );
  const command = continuationCommand(["wallet", "tx", "status", txHash], network);
  return commandError(
    "E_PAYMENT_OUTCOME_UNKNOWN",
    `${message} Check transaction ${txHash} with '${command}' before retrying.`,
    command,
  );
}

/**
 * Whether a send checks its access key only after finding no recorded send for its idempotency
 * key: a replay signs nothing, so it needs no usable key. Dry runs and unkeyed sends check it first.
 */
export function defersKeyCheck(options: {
  "dry-run"?: boolean | undefined;
  "idempotency-key"?: string | undefined;
}) {
  return options["idempotency-key"] !== undefined && !options["dry-run"];
}

/** The `--idempotency-key` value, checked to be 1 to 255 characters. */
export function idempotencyKey(value: string | undefined) {
  if (value !== undefined && (value.length === 0 || value.length > 255))
    throw usageError("Invalid --idempotency-key: expected 1 to 255 characters");
  return value;
}

/** A transaction a command is about to send, and the idempotency key it is sent under, if any. */
export type TxSend = {
  label: "Transfer" | "Swap";
  network: Network;
  idempotency:
    | {
        key: string;
        /** The sending wallet; a key is scoped to one wallet on one network. */
        wallet: string;
        /** The command and its normalized arguments, which the key is bound to. */
        request: Record<string, string | null>;
        /** Reads a recorded transaction's state on chain for a replay. */
        getTxStatus: (txHash: string) => Promise<TxState>;
      }
    | undefined;
};

/**
 * What an earlier send under `tx`'s idempotency key recorded, or `undefined` when the key is unused
 * or `tx` has none:
 * - a recorded send replays its result, with `status` read from the chain and `idempotent_replay`;
 * - a key claimed by a send whose outcome is not recorded, because that run is still sending or
 *   stopped first, is `E_PAYMENT_OUTCOME_UNKNOWN` naming its hash when known;
 * - a key sent with another request fails with `E_USAGE` naming the arguments that differ.
 * Records older than 30 days are pruned first, so their keys count as unused. `result` is the type
 * of the command's successful result. Call it before `submitTransaction`, and never on a dry run.
 */
export async function recordedSend<result extends object>(tx: TxSend) {
  const { idempotency } = tx;
  if (!idempotency) return undefined;
  await pruneIdempotencyRecords();
  const record = await loadIdempotencyRecord({
    key: idempotency.key,
    wallet: idempotency.wallet,
    chainId: tx.network.chainId,
  });
  return record === undefined ? undefined : recordedOutcome<result>({ ...tx, idempotency }, record);
}

async function recordedOutcome<result extends object>(
  tx: TxSend & { idempotency: NonNullable<TxSend["idempotency"]> },
  record: IdempotencyRecord | null,
) {
  const { idempotency } = tx;
  const key = JSON.stringify(escapeInvisible(idempotency.key));
  if (record) {
    const differs = Object.keys({ ...record.request, ...idempotency.request }).filter(
      (field) => record.request[field] !== idempotency.request[field],
    );
    if (differs.length > 0)
      throw usageError(
        `Idempotency key ${key} was already used on this wallet and network for a different request (different ${differs.includes("command") ? "command" : differs.join(", ")}). Use a new key for a new request.`,
      );
    if (record.status === "success" && record.tx_hash !== null && record.result !== null) {
      const status = await idempotency.getTxStatus(record.tx_hash);
      return {
        ...(record.result as unknown as Omit<result, "status">),
        status,
        idempotent_replay: true as const,
        ...(status === "pending" ? txStatusNext(record.tx_hash, tx.network) : {}),
      };
    }
  }
  const txHash = record?.tx_hash ?? undefined;
  return txOutcomeUnknown(
    txHash === undefined
      ? `${tx.label} with idempotency key ${key} may have been sent: another run with this key is still sending, or stopped before recording its outcome. Check the wallet balance before retrying with a new key.`
      : `${tx.label} with idempotency key ${key} was submitted, but its outcome was not recorded.`,
    tx.network,
    txHash,
  );
}

/**
 * Sends a transaction with `submit` and returns `result` for its hash.
 *
 * Under an idempotency key, the key is claimed first with a `submitting` record, and the hash and
 * result are recorded once sent. A claim lost to another run since `recordedSend` looked returns
 * that run's outcome instead of sending. An error the CLI raises in `submit` comes before signing,
 * such as a wallet that is no longer logged in, and frees the key; any other failure keeps the
 * claim, so a rerun with the key does not send again.
 *
 * A failure that may have sent the transaction is `E_PAYMENT_OUTCOME_UNKNOWN`, naming its hash when
 * the error carries one.
 */
export async function submitTransaction<result extends object>(
  tx: TxSend,
  submit: () => Promise<string>,
  result: (txHash: string) => result,
) {
  const { idempotency } = tx;
  let record: IdempotencyRecord | undefined;
  if (idempotency) {
    record = {
      key: idempotency.key,
      wallet: idempotency.wallet,
      chain_id: tx.network.chainId,
      request: idempotency.request,
      status: "submitting",
      tx_hash: null,
      created_at: nowSeconds(),
      result: null,
    };
    if (!(await createIdempotencyRecord(record))) {
      const claimed = await loadIdempotencyRecord({
        key: idempotency.key,
        wallet: idempotency.wallet,
        chainId: tx.network.chainId,
      });
      return recordedOutcome<result>({ ...tx, idempotency }, claimed ?? null);
    }
  }
  let txHash: string;
  try {
    txHash = await submit();
  } catch (error) {
    const sentHash = txHashFromError(error);
    const unknown =
      error instanceof Errors.IncurError && error.code === "E_PAYMENT_OUTCOME_UNKNOWN";
    if (record && sentHash)
      await saveIdempotencyRecord({ ...record, tx_hash: sentHash }).catch(() => undefined);
    else if (record && error instanceof Errors.IncurError && !unknown)
      await deleteIdempotencyRecord(record);
    if (sentHash)
      return txOutcomeUnknown(
        `${tx.label} was submitted but did not confirm.`,
        tx.network,
        sentHash,
      );
    if (unknown) return txOutcomeUnknown(error.message, tx.network);
    throw error;
  }
  const value = result(txHash);
  // The transaction is sent, so failing to record it must not fail the command.
  if (record)
    await saveIdempotencyRecord({
      ...record,
      status: "success",
      tx_hash: txHash,
      result: value as Record<string, unknown>,
    }).catch(() => undefined);
  return value;
}

/**
 * The transaction hash a send error carries: a node that accepts a transaction but does not include
 * it before the `eth_sendRawTransactionSync` timeout fails with code 4 and the hash as `data`
 * (EIP-7966). Wrapped errors are searched through their `cause`.
 */
function txHashFromError(error: unknown) {
  let current = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const { cause, code, data } = getRecord(current);
    if (code === 4 && typeof data === "string" && txHashPattern.test(data))
      return data.toLowerCase();
    current = cause;
  }
  return undefined;
}
