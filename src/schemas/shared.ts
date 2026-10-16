import { z } from "incur";

/** CLI-level options incur parses anywhere in argv; commands and middleware read `c.globals`. */
export const cliGlobals = z.object({
  network: z
    .string()
    .optional()
    .describe(
      "Network to use: mainnet or testnet (default: TEMPO_WALLET_NETWORK, then the saved network setting, then the logged-in wallet's network)",
    ),
});

export const cliGlobalAlias = { network: "n" };

export const globalOptionShape = {
  verbose: z.boolean().optional().describe("Increase verbosity"),
  silent: z.boolean().optional().describe("Silent mode: suppress non-essential output"),
  "json-output": z.boolean().optional().describe("Quick switch for JSON output format"),
  "toon-output": z.boolean().optional().describe("Quick switch for TOON output format"),
};

export const globalAlias = {
  verbose: "v",
  silent: "s",
  "json-output": "j",
  "toon-output": "t",
};

export const globalOptions = z.object(globalOptionShape);

/** Wallet-app flows open a browser unless `--no-browser` asks them to print the URL and code. */
export const browserOption = z
  .boolean()
  .default(true)
  .describe("Open a browser; use --no-browser to disable");

/** Matches `networkFields`: the chain a command ran against and its network label. */
export const networkOutputShape = {
  chain_id: z.number(),
  network: z.string(),
};

/** Continuation fields on results with a follow-up command; built by `nextStep`. */
export const nextOutputShape = {
  instruction: z.string().optional().describe("What to do next"),
  _next: z
    .object({
      argv: z.array(z.string()).describe("Next command as an argument vector; authoritative"),
      command: z.string().describe("argv quoted for a POSIX shell"),
      until: z
        .string()
        .optional()
        .describe("jq condition on the next command's JSON output; rerun it until true"),
      poll_interval_seconds: z
        .number()
        .optional()
        .describe("Seconds to wait before running the next command, and between reruns"),
    })
    .optional(),
};

/** A transaction's state on chain, as `tx status` reads it. */
export const txStateSchema = z.enum(["success", "reverted", "pending", "not_found"]);

/** `--idempotency-key` on the commands that send a transaction. */
export const idempotencyKeyOption = z
  .string()
  .optional()
  .describe(
    "Send at most once per key for this wallet and network; a retry with the same key returns the recorded result instead of sending again",
  );

/** Fields a send replayed from its idempotency key adds to the result it recorded. */
export const replayOutputShape = {
  status: txStateSchema.describe("The recorded transaction's state on chain now"),
  idempotent_replay: z
    .literal(true)
    .describe("Nothing was sent: this is the result recorded for the idempotency key"),
  ...nextOutputShape,
};
