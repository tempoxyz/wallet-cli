import { Errors } from "incur";

import { sanitizeText } from "./utils.js";

export function usageError(message: string) {
  return new Errors.IncurError({ code: "E_USAGE", message, exitCode: 2 });
}

export function networkError(message: string) {
  return new Errors.IncurError({ code: "E_NETWORK", message, exitCode: 3 });
}

// Payment messages can embed challenge fields and SDK/RPC error text from servers.
export function paymentError(message: string) {
  return new Errors.IncurError({ code: "E_PAYMENT", message: sanitizeText(message), exitCode: 4 });
}

export function authRefreshRequiredError(
  reason: "expired" | "missing" | "unusable",
  network: "mainnet" | "testnet",
) {
  const detail =
    reason === "missing"
      ? "No usable access key is configured."
      : `The configured access key is ${reason}.`;
  return new Errors.IncurError({
    code: "E_AUTH_REFRESH_REQUIRED",
    message: `${detail} Run 'tempo wallet refresh --network ${network}' before retrying.`,
    exitCode: 4,
  });
}

export function httpError(status: number) {
  return new Errors.IncurError({ code: "E_HTTP", message: `HTTP ${status}`, exitCode: 3 });
}

export function paymentOutcomeUnknownError(message: string) {
  return new Errors.IncurError({
    code: "E_PAYMENT_OUTCOME_UNKNOWN",
    message: sanitizeText(message),
    exitCode: 4,
  });
}
