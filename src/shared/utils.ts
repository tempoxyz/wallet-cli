import { parseUnits } from "viem";

import { usageError } from "./errors.js";

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

// CSI, then OSC/DCS/SOS/PM/APC strings, then other ESC sequences, with 7-bit or 8-bit
// introducers. A string stops at its first control character; without BEL or ST only the
// introducer is removed, so the text after it is kept.
const terminalEscapeSequences =
  // oxlint-disable-next-line no-control-regex
  /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b[\]PX^_]|[\u0090\u0098\u009d-\u009f])(?:[^\u0000-\u001f\u007f-\u009f]*(?:\u0007|\u001b\\|\u009c))?|\u001b[ -/]*[0-~]/g;
// Controls, default-ignorables (zero-width, variation selectors, tags), bidi controls, line and
// paragraph separators, and interlinear annotation characters.
const invisibleCharacters =
  /[\p{Cc}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\u2028\u2029\ufff9-\ufffb]/gu;

/** Removes terminal escape sequences and invisible characters, except tabs and newlines, from untrusted text. */
export function sanitizeText(value: string) {
  return value
    .replace(terminalEscapeSequences, "")
    .replace(invisibleCharacters, (char) => (char === "\t" || char === "\n" ? char : ""));
}

/** Shows invisible characters in an untrusted identifier as JSON-style `\uXXXX` escapes. */
export function escapeInvisible(value: string) {
  return value.replace(invisibleCharacters, (char) =>
    char
      .split("")
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join(""),
  );
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

/** Parses a positive token amount, rejecting fractional digits that `parseUnits` would round. */
export function parseTokenAmount(value: string, decimals: number) {
  const fraction = value.split(".")[1] ?? "";
  const amount =
    /^\d+(?:\.\d+)?$/.test(value) && fraction.length <= decimals ? parseUnits(value, decimals) : 0n;
  if (amount <= 0n)
    throw usageError(
      `Invalid amount: expected a positive decimal with at most ${decimals} decimals`,
    );
  return amount;
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
