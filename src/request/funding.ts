import { decodeFunctionData, zeroAddress, type Address } from "viem";
import { Abis as TempoAbis, Actions } from "viem/tempo";

import { paymentError } from "../shared/errors.js";
import { createTempoPublicClient, type Network } from "../shared/network.js";
import { tokenSymbol } from "../shared/tokens.js";
import { nowSeconds } from "../shared/utils.js";
import { accessKeyLimitError } from "../wallet/access-key.js";
import { type PaymentIdentity, storedAccessKeyLimit } from "./identity.js";
import { formatTokenAmount } from "./spend.js";

type Rpc = { timeout?: number; retryCount?: number };

/**
 * How much of a token the payer's signer may spend: `unlimited` for the wallet itself or a key
 * without a spending policy, `limited` with the key's remaining on-chain limit (or, for a key not
 * yet published, the limit its stored authorization grants), and `unusable` for a revoked, expired,
 * mismatched or unauthorized key, which can send nothing.
 */
export type KeyAllowance =
  | { kind: "limited"; remaining: bigint }
  | { kind: "unlimited" }
  | { kind: "unusable" };

/** Reads the allowance `identity`'s signer has for `token` on `chainId`. */
export async function readKeyAllowance(
  identity: PaymentIdentity,
  options: { chainId: number; rpc?: Rpc | undefined; token: string },
): Promise<KeyAllowance> {
  if (!("key" in identity)) return { kind: "unlimited" };
  const client = createTempoPublicClient(options.chainId, options.rpc ?? {});
  const parameters = { account: identity.address, accessKey: identity.signerAddress };
  const metadata = await Actions.accessKey.getMetadata(client, parameters);
  if (metadata.isRevoked) return { kind: "unusable" };
  if (metadata.address === zeroAddress) {
    if (!identity.key.keyAuthorization) return { kind: "unusable" };
    const limit = storedAccessKeyLimit(identity.key, options.token);
    return limit === null ? { kind: "unlimited" } : { kind: "limited", remaining: limit };
  }
  if (
    metadata.address.toLowerCase() !== identity.signerAddress.toLowerCase() ||
    (metadata.expiry !== 0n && metadata.expiry <= BigInt(nowSeconds()))
  )
    return { kind: "unusable" };
  if (metadata.spendPolicy === "unlimited") return { kind: "unlimited" };
  const { remaining } = await Actions.accessKey.getRemainingLimit(client, {
    ...parameters,
    token: options.token as Address,
  });
  return { kind: "limited", remaining };
}

/**
 * The payer's balance of `token` and its signer's allowance for it. An allowance the chain does not
 * answer is `unknown` and leaves the limit to the chain; the balance read must succeed.
 */
export async function readFundingCapacity(
  identity: PaymentIdentity,
  options: { chainId: number; rpc?: Rpc | undefined; token: string },
) {
  const [balance, allowance] = await Promise.all([
    Actions.token
      .getBalance(createTempoPublicClient(options.chainId, options.rpc ?? {}) as never, {
        account: identity.address,
        token: options.token as Address,
      })
      .then((result) => result.amount),
    readKeyAllowance(identity, options).catch((): { kind: "unknown" } => ({ kind: "unknown" })),
  ]);
  return { allowance, balance };
}

export type FundingCapacity = Awaited<ReturnType<typeof readFundingCapacity>>;

/** The most `capacity` lets the payer send: its balance, bounded by its signer's allowance. */
export function spendableAmount(capacity: FundingCapacity) {
  if (capacity.allowance.kind === "unusable") return 0n;
  if (capacity.allowance.kind !== "limited") return capacity.balance;
  return capacity.allowance.remaining < capacity.balance
    ? capacity.allowance.remaining
    : capacity.balance;
}

/**
 * Refuses a transaction that would spend `amount` of `options.token` (raw units, 6 decimals) when
 * the chain would reject it: the access key's remaining spending limit or the wallet's balance is
 * below it. A sponsored transaction that fails on chain still lands, so this check runs before
 * signing rather than leaving the failure to the chain.
 */
export function assertCanFund(
  identity: PaymentIdentity,
  options: {
    amount: bigint;
    capacity: FundingCapacity;
    label?: string | undefined;
    network: Network;
    purpose: string;
    token: string;
  },
) {
  assertKeyCanFund(identity, { ...options, allowance: options.capacity.allowance });
  if (options.capacity.balance < options.amount)
    throw paymentError(
      `Insufficient balance for ${options.purpose}: available=${formatTokenAmount(options.capacity.balance)} required=${formatTokenAmount(options.amount)}`,
    );
}

/**
 * Refuses a transaction that would spend `amount` of `options.token` when the payer's signer
 * cannot: its access key is unusable, or its remaining spending limit is below `amount`. An
 * `unknown` allowance leaves the limit to the chain.
 */
export function assertKeyCanFund(
  identity: PaymentIdentity,
  options: {
    allowance: FundingCapacity["allowance"];
    amount: bigint;
    label?: string | undefined;
    network: Network;
    purpose: string;
    token: string;
  },
) {
  const { allowance } = options;
  if ("key" in identity && allowance.kind === "unusable")
    throw paymentError(
      `The access key ${identity.signerAddress.toLowerCase()} is revoked, expired or not authorized for this wallet, so it cannot fund the ${options.purpose}.`,
    );
  if ("key" in identity && allowance.kind === "limited" && allowance.remaining < options.amount)
    throw accessKeyLimitError({
      key: identity.key.address,
      token: options.token,
      label: options.label ?? tokenSymbol(options.token, options.network.chainId) ?? options.token,
      amount: formatTokenAmount(options.amount),
      network: options.network,
    });
}

const tip20SpendFunctions = new Set(["approve", "transfer", "transferWithMemo"]);

/**
 * The token and raw amount a list of calls spends, read from TIP-20 `transfer`,
 * `transferWithMemo` and `approve` calls to the first call's token; undefined when the first call
 * is none of those.
 */
export function spentByCalls(calls: readonly { data?: `0x${string}` | undefined; to: string }[]) {
  const token = calls[0]?.to.toLowerCase();
  if (!token) return undefined;
  let amount = 0n;
  for (const call of calls) {
    if (call.to.toLowerCase() !== token || !call.data) continue;
    const decoded = (() => {
      try {
        return decodeFunctionData({ abi: TempoAbis.tip20, data: call.data });
      } catch {
        return undefined;
      }
    })();
    if (!decoded || !tip20SpendFunctions.has(decoded.functionName)) continue;
    const value = (decoded.args as readonly unknown[])[1];
    if (typeof value === "bigint") amount += value;
  }
  return amount > 0n ? { amount, token } : undefined;
}
