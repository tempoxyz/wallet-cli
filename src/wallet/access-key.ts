import type { WalletState } from "./store.js";

export type LocalAccessKeyStatus = "expired" | "pending" | "ready" | "unusable";

type AccessKey = WalletState["accessKeys"][number];

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

export function isPaymentCapableAccessKey(key: AccessKey) {
  const status = localAccessKeyStatus(key);
  return status === "ready" || status === "pending";
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
