export function getRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function getArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function cleanStoredScalar(value: string) {
  return value.replace(/#__bigint$/, "");
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function formatUnixTimestamp(value: number | undefined) {
  if (value === undefined) return null;
  return new Date(value * 1000).toISOString().replace(".000Z", "Z");
}

export function formatMicroUnits(value: string) {
  if (!/^\d+$/.test(value)) return value;
  const raw = BigInt(value);
  const divisor = 1_000_000n;
  const whole = raw / divisor;
  const fractional = raw % divisor;
  return `${whole}.${fractional.toString().padStart(6, "0")}`;
}

export function formatTokenUnits(value: bigint, decimals: number) {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fractional = value % divisor;
  if (decimals === 0) return whole.toString();
  if (fractional === 0n) return `${whole}.${"0".repeat(decimals)}`;
  return `${whole}.${fractional.toString().padStart(decimals, "0")}`;
}

export function formatCreditBalance(rawBalance: bigint) {
  const divisor = 10_000n;
  const whole = rawBalance / divisor;
  const fractional = rawBalance % divisor;
  if (fractional === 0n) return whole.toString();
  return `${whole}.${fractional.toString().padStart(4, "0")}`;
}

export function isChannelId(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function parseStoredBigInt(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export function parseOnChainBigInt(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return undefined;
}

export function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

export function decodeBase64UrlJson(value: string) {
  return getRecord(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
}
