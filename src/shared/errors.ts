import { Errors } from "incur";

import type { Network } from "./network.js";
import { continuationCommand } from "./next.js";

/** Every error code the CLI reports, with its process exit code and default retryability. */
export const errorCodes = {
  E_USAGE: {
    exitCode: 2,
    retryable: false,
    description: "Invalid arguments, input, or local configuration.",
  },
  E_NOT_FOUND: {
    exitCode: 2,
    retryable: false,
    description: "A required session, key, or record was not found.",
  },
  E_NETWORK: {
    exitCode: 3,
    retryable: false,
    description: "A network request failed or was refused.",
  },
  E_HTTP: {
    exitCode: 3,
    retryable: false,
    description: "The server returned an HTTP error status.",
  },
  E_RPC: {
    exitCode: 3,
    retryable: false,
    description: "An RPC read failed; reported inline in command output.",
  },
  E_POLL_TIMEOUT: {
    exitCode: 3,
    retryable: true,
    description: "Stopped waiting before the expected result arrived.",
  },
  E_PAYMENT: {
    exitCode: 4,
    retryable: false,
    description: "The payment challenge or settlement was rejected.",
  },
  E_PAYMENT_OUTCOME_UNKNOWN: {
    exitCode: 4,
    retryable: false,
    description: "A payment or transaction may have completed; check before retrying.",
  },
  E_NOT_AUTHENTICATED: {
    exitCode: 4,
    retryable: false,
    description: "No wallet is logged in.",
  },
  E_LOGIN_DENIED: {
    exitCode: 4,
    retryable: false,
    description: "The login request was denied in the wallet app.",
  },
  E_LOGIN_EXPIRED: {
    exitCode: 4,
    retryable: false,
    description: "The login code expired before it was approved.",
  },
  E_AUTH_REFRESH_REQUIRED: {
    exitCode: 4,
    retryable: false,
    description: "The access key must be refreshed with 'tempo wallet refresh'.",
  },
  E_KEY_EXPIRED: {
    exitCode: 4,
    retryable: false,
    description: "The access key has expired.",
  },
  E_LIMIT_EXCEEDED: {
    exitCode: 4,
    retryable: false,
    description: "The amount exceeds a spending limit, --max-spend, or a reviewed swap bound.",
  },
  E_INSUFFICIENT_FUNDS: {
    exitCode: 4,
    retryable: false,
    description: "The wallet balance is too low.",
  },
  E_RUNTIME: {
    exitCode: 1,
    retryable: false,
    description: "An unexpected internal failure.",
  },
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

/**
 * A `commandError` thrown below a command's `run`, where returning `c.error` is not possible.
 * incur drops the `cta` of thrown errors, so each CLI registers `ctaErrors`, which returns it
 * through `c.error` instead.
 */
export class CtaError extends Errors.IncurError {
  /** The `c.error` payload, `cta` included. */
  readonly payload: CommandErrorPayload;

  constructor(payload: CommandErrorPayload) {
    super(payload);
    this.payload = payload;
  }
}

/** incur middleware that returns a thrown `CtaError` through `c.error`, keeping its `cta`. */
export async function ctaErrors(
  context: { error: (payload: CommandErrorPayload) => never },
  next: () => Promise<void>,
) {
  try {
    await next();
  } catch (error) {
    if (!(error instanceof CtaError)) throw error;
    context.error(error.payload);
  }
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
