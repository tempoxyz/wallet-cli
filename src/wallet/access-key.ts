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
 * E_LIMIT_EXCEEDED for an access key whose spending limit cannot cover `amount` (token units) of
 * `token`, with the `tempo wallet keys update` that sets the limit to that amount as its `cta`.
 * `label` names the token in the message.
 */
export function accessKeyLimitError(options: {
  key: string;
  token: string;
  label: string;
  amount: string;
  network: Network;
}) {
  const { key, token, label, amount, network } = options;
  const command = continuationCommand(
    ["wallet", "keys", "update", key.toLowerCase(), "--token", token, "--limit", amount],
    network,
  );
  return new CtaError(
    commandError(
      "E_LIMIT_EXCEEDED",
      `The access key cannot spend ${amount} ${label}. Ask the wallet owner to run '${command}', then retry.`,
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
