import { CtaError } from "../cli/incur-compat.js";
import { commandError } from "../shared/errors.js";
import type { Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import type { WalletState } from "./store.js";

export type LocalAccessKeyStatus = "expired" | "pending" | "ready" | "unusable";

type AccessKey = WalletState["accessKeys"][number];

/**
 * A key's status from the wallet store alone. `pending` means it carries the wallet's signed
 * authorization: signed, but not yet published on chain when it was stored. Its first payment
 * publishes it, and the store can keep the authorization after that, so only the chain tells
 * whether a pending key is published.
 */
export function localAccessKeyStatus(
  key: AccessKey,
  now = Math.floor(Date.now() / 1000),
): LocalAccessKeyStatus {
  if (key.expiry !== undefined && key.expiry <= now) return "expired";
  if (!hasLocalSigningMaterial(key) || !hasSupportedKeyType(key)) return "unusable";
  if (key.keyAuthorization === undefined) return "ready";
  if (!isStructuredKeyAuthorization(key.keyAuthorization, key)) return "unusable";

  const expiry = (key.keyAuthorization as { expiry?: unknown }).expiry;
  if (typeof expiry === "number" && expiry <= now) return "expired";
  return "pending";
}

/** A pending key can pay: its signed authorization is published with its first payment. */
export function isPaymentCapableStatus(status: LocalAccessKeyStatus) {
  return status === "ready" || status === "pending";
}

export function isPaymentCapableAccessKey(key: AccessKey) {
  return isPaymentCapableStatus(localAccessKeyStatus(key));
}

export function selectPaymentCapableAccessKey(
  accessKeys: WalletState["accessKeys"],
  options: { chainId: number; walletAddress: string },
) {
  return accessKeys.find((key) => accessKeyMatches(key, options) && isPaymentCapableAccessKey(key));
}

export function accessKeyMatches(
  key: AccessKey,
  options: { chainId: number; walletAddress: string },
) {
  return (
    key.chainId === options.chainId &&
    key.access.toLowerCase() === options.walletAddress.toLowerCase()
  );
}

/**
 * How much of an access key's spending limit a Tempo DEX swap of at most `maxAmountIn` uses: the
 * `approve` of the DEX and the DEX's pull of the input each count against it, so a key needs twice
 * the input. A key with less passes a single-spend check and then reverts in simulation.
 */
export function dexSwapSpend(maxAmountIn: bigint) {
  return 2n * maxAmountIn;
}

/**
 * E_LIMIT_EXCEEDED for an access key whose spending limit cannot cover `amount` (token units) of
 * `token`, with the `tempo wallet keys update` that sets the limit to that amount as its `cta`.
 * `label` names the token in the message, and `remaining`, when given, what the key has left.
 * `swap` explains that a DEX swap counts twice, and `walletApp` that a send would otherwise have
 * gone to the wallet app for approval.
 */
export function accessKeyLimitError(options: {
  key: string;
  token: string;
  label: string;
  amount: string;
  remaining?: string | undefined;
  swap?: boolean | undefined;
  walletApp?: boolean | undefined;
  network: Network;
}) {
  const { key, token, label, amount, remaining, network } = options;
  const command = continuationCommand(
    ["wallet", "keys", "update", key.toLowerCase(), "--token", token, "--limit", amount],
    network,
  );
  const needs = options.swap
    ? `the ${amount} ${label} a DEX swap needs (its approve and the DEX's pull each count)`
    : `${amount} ${label}`;
  const fallback = options.walletApp
    ? ": sending would need the wallet app to approve it instead"
    : "";
  return new CtaError(
    commandError(
      "E_LIMIT_EXCEEDED",
      remaining === undefined
        ? `The access key cannot spend ${needs}. Ask the wallet owner to run '${command}', then retry.`
        : `The access key has ${remaining} ${label} left of its spending limit, short of ${needs}, so nothing was sent${fallback}. Ask the wallet owner to run '${command}', then retry.`,
      command,
    ),
  );
}

function hasSupportedKeyType(key: AccessKey) {
  return key.keyType === undefined || key.keyType === "secp256k1" || key.keyType === "p256";
}

function hasLocalSigningMaterial(key: AccessKey) {
  if (key.privateKey && /^0x[0-9a-f]{64}$/i.test(key.privateKey)) return true;
  if (key.publicKey && key.handle && typeof key.handle === "object") return true;
  if (key.keyPair && typeof key.keyPair === "object") return true;
  return false;
}

function isStructuredKeyAuthorization(value: unknown, key: AccessKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const authorization = value as Record<string, unknown>;
  const keyType = key.keyType ?? "secp256k1";
  if (
    typeof authorization.address !== "string" ||
    authorization.address.toLowerCase() !== key.address.toLowerCase() ||
    (typeof authorization.chainId !== "bigint" && typeof authorization.chainId !== "number") ||
    authorization.type !== keyType ||
    !authorization.signature ||
    typeof authorization.signature !== "object" ||
    Array.isArray(authorization.signature)
  )
    return false;

  try {
    const authorizationChainId = BigInt(authorization.chainId);
    return authorizationChainId === 0n || authorizationChainId === BigInt(key.chainId);
  } catch {
    return false;
  }
}
