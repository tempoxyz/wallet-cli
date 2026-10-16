import { Errors } from "incur";

/**
 * Every error code the CLI reports, with its process exit code and default retryability.
 *
 * Keep one code per line, sorted by code, so a new code is one added line and changes that add
 * different codes do not conflict. `oxfmt-ignore` keeps the formatter from wrapping the lines.
 */
// oxfmt-ignore
export const errorCodes = {
  E_AUTH_REFRESH_REQUIRED: { exitCode: 4, retryable: false, description: "The access key must be refreshed with 'tempo wallet refresh'." },
  E_HTTP: { exitCode: 3, retryable: false, description: "The server returned an HTTP error status." },
  E_INSUFFICIENT_FUNDS: { exitCode: 4, retryable: false, description: "The wallet balance is too low." },
  E_KEY_EXPIRED: { exitCode: 4, retryable: false, description: "The access key has expired." },
  E_LIMIT_EXCEEDED: { exitCode: 4, retryable: false, description: "The amount exceeds a spending limit, --max-spend, or a reviewed swap bound." },
  E_LOGIN_DENIED: { exitCode: 4, retryable: false, description: "The login request was denied in the wallet app." },
  E_LOGIN_EXPIRED: { exitCode: 4, retryable: false, description: "The login code expired before it was approved." },
  E_NETWORK: { exitCode: 3, retryable: false, description: "A network request failed or was refused." },
  E_NOT_AUTHENTICATED: { exitCode: 4, retryable: false, description: "No wallet is logged in." },
  E_NOT_FOUND: { exitCode: 2, retryable: false, description: "A required session, key, or record was not found." },
  E_PAYMENT: { exitCode: 4, retryable: false, description: "The payment challenge or settlement was rejected." },
  E_PAYMENT_OUTCOME_UNKNOWN: { exitCode: 4, retryable: false, description: "A payment or transaction may have completed; check before retrying." },
  E_POLL_TIMEOUT: { exitCode: 3, retryable: true, description: "Stopped waiting before the expected result arrived." },
  E_RPC: { exitCode: 3, retryable: false, description: "An RPC read failed; reported inline in command output." },
  E_RUNTIME: { exitCode: 1, retryable: false, description: "An unexpected internal failure." },
  E_USAGE: { exitCode: 2, retryable: false, description: "Invalid arguments, input, or local configuration." },
} as const satisfies Record<string, { exitCode: number; retryable: boolean; description: string }>;

export type WalletErrorCode = keyof typeof errorCodes;

/** Creates an incur error whose exit code and default retryability come from `errorCodes`. */
export function walletError(options: {
  code: WalletErrorCode;
  message: string;
  retryable?: boolean | undefined;
  cause?: Error | undefined;
}) {
  const { exitCode, retryable } = errorCodes[options.code];
  return new Errors.IncurError({
    ...options,
    exitCode,
    retryable: options.retryable ?? retryable,
  });
}

/** An error shaped for incur's `c.error`, with the commands that fix it as its `cta`. */
export type CommandErrorPayload = {
  code: WalletErrorCode;
  message: string;
  exitCode: number;
  retryable: boolean;
  cta: { commands: { command: string; description?: string | undefined }[] };
};

/**
 * An error for incur's `c.error` whose `cta` is the command to run next. Commands return it
 * from `run` instead of throwing it, because incur drops the `cta` of thrown errors.
 */
export function commandError(
  code: WalletErrorCode,
  message: string,
  command: string,
  options: { retryable?: boolean | undefined } = {},
): CommandErrorPayload {
  const { exitCode, retryable } = errorCodes[code];
  return {
    code,
    message,
    exitCode,
    retryable: options.retryable ?? retryable,
    cta: { commands: [{ command }] },
  };
}

/**
 * What a command that needs confirmation uses of incur's run context: `agent` is set when no one
 * can answer a prompt, and `error` keeps the `cta` that thrown errors lose.
 */
export type CommandContext = {
  agent: boolean;
  error: (error: CommandErrorPayload) => never;
};

export function usageError(message: string) {
  return walletError({ code: "E_USAGE", message });
}

export function networkError(message: string, options: { retryable?: boolean } = {}) {
  return walletError({ code: "E_NETWORK", message, ...options });
}

export function paymentError(message: string) {
  return walletError({ code: "E_PAYMENT", message });
}

export function httpError(status: number, message = `HTTP ${status}`) {
  return walletError({ code: "E_HTTP", message });
}

export function paymentOutcomeUnknownError(message: string) {
  return walletError({ code: "E_PAYMENT_OUTCOME_UNKNOWN", message });
}
