#!/usr/bin/env node
import { Cli, Completions, Mcp, type z } from "incur";

import type { WalletCommand } from "./cli/command.js";
import completions from "./commands/completions.js";
import debug from "./commands/debug.js";
import doctor from "./commands/doctor.js";
import fund from "./commands/fund.js";
import keys from "./commands/keys.js";
import login from "./commands/login.js";
import logout from "./commands/logout.js";
import refresh from "./commands/refresh.js";
import revoke from "./commands/revoke.js";
import services, { staleListFetchedAt } from "./commands/services.js";
import sessions, { closeCommandFailed } from "./commands/sessions.js";
import swap from "./commands/swap.js";
import transfer from "./commands/transfer.js";
import whoami from "./commands/whoami.js";
import { completionScript } from "./completions.js";
import { servicesMcpOutput } from "./schemas/services.js";
import { cliGlobalAlias, cliGlobals } from "./schemas/shared.js";
import { bindOptionValues } from "./shared/argv.js";
import { version } from "./shared/constants.js";
import { ctaErrors } from "./shared/errors.js";

const cli = Cli.create("tempo wallet", {
  version,
  description: "Wallet identity and custody operations",
  sync: {
    suggestions: [
      "log in to a Tempo wallet",
      "show the current Tempo wallet account",
      "transfer tokens with the Tempo wallet CLI",
    ],
  },
  globals: cliGlobals,
  globalAlias: cliGlobalAlias,
  // The Tempo launcher manages updates, so skip incur npm update checks.
  update: false,
});

// Returns a thrown CtaError through `c.error`, so it keeps its cta; MCP registers it below.
cli.use(ctaErrors);

// Mounted in this order, which shell completions list them in.
const commands: WalletCommand[] = [
  login,
  refresh,
  logout,
  whoami,
  keys,
  revoke,
  transfer,
  swap,
  fund,
  sessions,
  services,
  doctor,
  debug,
  completions,
];

for (const { command } of commands) cli.command(command);

/** Each MCP tool's annotations by tool name, from the `annotations` of its command. */
const toolAnnotations = Object.fromEntries(
  commands.flatMap(({ annotations }) => Object.entries(annotations)),
);

void main();

export default cli;

function walletCommands() {
  // incur keys this map by the default Cli type; the globals generic does not change the entry.
  const entries = Cli.toCommands.get(cli as never);
  if (!entries) throw new Error("Unable to access wallet commands");
  return entries as Map<string, unknown>;
}

function createMcpCommands() {
  const mcpCommands = withMcpGlobals(walletCommands());
  const sessionsGroup = mcpCommands.get("sessions");
  if (isCommandGroup(sessionsGroup)) {
    // Bare `sessions` is CLI shorthand; MCP already exposes `sessions_list`.
    const { root: _root, ...group } = sessionsGroup;
    mcpCommands.set("sessions", group);
  }
  const servicesCommand = mcpCommands.get("services");
  if (isRunnableCommand(servicesCommand)) {
    mcpCommands.set("services", {
      ...servicesCommand,
      output: servicesMcpOutput,
      async run(context: unknown) {
        const value = await servicesCommand.run(context);
        // MCP structuredContent must be a top-level object. Keep normal CLI output unchanged.
        if (Array.isArray(value)) {
          const fetchedAt = staleListFetchedAt(value);
          return { services: value, ...(fetchedAt ? { stale: true, fetched_at: fetchedAt } : {}) };
        }
        return value;
      },
    });
  }

  return mcpCommands;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--describe")) {
    process.stdout.write(`${JSON.stringify(describeCli())}\n`);
    process.exit(0);
  }

  const args = expandHelp(normalizeServicesOutputAliases(bindCommandOptions(rawArgs)));

  if (handleBuiltinSchema(args)) process.exit(0);

  if (args.includes("--mcp")) {
    await Mcp.serve(cli.name, version, createMcpCommands(), {
      env: cli.env,
      middlewares: [ctaErrors],
      tools: { discovery: "direct" },
      vars: cli.vars,
      version,
    });
    return;
  }

  const script = walletCompletions(args);
  if (script !== undefined) {
    process.stdout.write(`${script}\n`);
    return;
  }

  await cli.serve(args);
  // Preserve the summary on stdout; only a one-shot CLI invocation changes exit status.
  if (closeCommandFailed) process.exitCode = 1;
}

// `help [command...]` is shorthand for `[command...] --help`.
function expandHelp(args: string[]) {
  const index = firstCommandIndex(args);
  if (index === undefined || args[index] !== "help") return args;
  return [...args.slice(0, index), ...args.slice(index + 1), "--help"];
}

// Wallet-owned `completions` output; see completions.ts for which shells stay with incur.
function walletCompletions(args: readonly string[]) {
  const index = firstCommandIndex(args);
  if (index === undefined || args[index] !== "completions") return undefined;
  if (args.includes("--help") || args.includes("-h")) return undefined;
  // The first positional after `completions`, skipping flags and their values.
  const [shell] = commandTokens(args.slice(index + 1));
  return completionScript(shell, () => {
    const commands = walletCommands() as Parameters<typeof Completions.complete>[0];
    return [
      ...Completions.complete(commands, undefined, [""], 0),
      { value: "mcp", description: "Register as MCP server" },
      { value: "skills", description: "Sync skill files to agents" },
      { value: "help", description: "Show help for a command" },
      ...Completions.complete(commands, undefined, ["-"], 0, {
        schema: cliGlobals,
        alias: cliGlobalAlias,
      }),
    ];
  });
}

/**
 * MCP tool calls carry no CLI globals, so accept `network` as a tool option and pass it on.
 * Each tool also declares its `toolAnnotations` entry, found by the tool name incur gives it
 * (`keys update` is `keys_update`).
 */
function withMcpGlobals(
  commands: Map<string, unknown>,
  prefix: readonly string[] = [],
): Map<string, unknown> {
  return new Map(
    [...commands].map(([name, entry]) => {
      const path = [...prefix, name];
      if (isCommandGroup(entry))
        return [
          name,
          {
            ...entry,
            // A group root (bare `login`) is a tool of its own.
            ...(isRunnableCommand(entry.root) ? { root: withMcpGlobal(entry.root, path) } : {}),
            commands: withMcpGlobals(entry.commands, path),
          },
        ];
      return [name, isRunnableCommand(entry) ? withMcpGlobal(entry, path) : entry];
    }),
  );
}

function withMcpGlobal(entry: RunnableCommand, path: readonly string[]) {
  return {
    ...entry,
    mcp: { annotations: toolAnnotations[path.join("_")] },
    options: entry.options ? entry.options.extend(cliGlobals.shape) : cliGlobals,
    run(context: { options: Record<string, unknown> }) {
      const { network, ...options } = context.options;
      return entry.run({ ...context, globals: { network }, options });
    },
  };
}

function isCommandGroup(
  value: unknown,
): value is { commands: Map<string, unknown>; root?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "_group" in value &&
    "commands" in value &&
    value.commands instanceof Map
  );
}

/** Binds the target command's option values before incur extracts globals; see bindOptionValues. */
function bindCommandOptions(args: readonly string[]) {
  const [name, subcommand] = commandTokens(args);
  const entry = name === undefined ? undefined : walletCommands().get(name);
  // A group without a known subcommand runs its root command (bare `sessions`).
  const command = isCommandGroup(entry)
    ? ((subcommand === undefined ? undefined : entry.commands.get(subcommand)) ?? entry.root)
    : entry;
  return bindOptionValues(args, [
    ...(isRunnableCommand(command) ? [command] : []),
    { options: cliGlobals, alias: cliGlobalAlias },
  ]);
}

type RunnableCommand = {
  alias?: Record<string, string | undefined> | undefined;
  options?: z.ZodObject | undefined;
  output?: unknown;
  run: (context: unknown) => unknown | Promise<unknown>;
};

function isRunnableCommand(value: unknown): value is RunnableCommand {
  return (
    typeof value === "object" && value !== null && "run" in value && typeof value.run === "function"
  );
}

function normalizeServicesOutputAliases(args: readonly string[]) {
  const commandIndex = firstCommandIndex(args);
  if (commandIndex === undefined || args[commandIndex] !== "services") return [...args];

  const normalized: string[] = [];
  let format: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json-output" || arg === "-j") {
      format ??= "json";
      if (isBooleanLiteral(args[index + 1])) index++;
      continue;
    }
    if (arg === "--toon-output" || arg === "-t") {
      format ??= "toon";
      if (isBooleanLiteral(args[index + 1])) index++;
      continue;
    }
    if (arg) normalized.push(arg);
  }

  if (!format || hasFormat(normalized)) return normalized;

  const normalizedCommandIndex = firstCommandIndex(normalized);
  if (normalizedCommandIndex === undefined) return normalized;
  return [
    ...normalized.slice(0, normalizedCommandIndex + 1),
    "--format",
    format,
    ...normalized.slice(normalizedCommandIndex + 1),
  ];
}

function firstCommandIndex(args: readonly string[]) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (takesValue(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("--format=") || arg.startsWith("--token-limit=")) continue;
    if (arg.startsWith("-")) continue;
    return index;
  }
  return undefined;
}

/** Flags whose next token is their value rather than a command name. */
function takesValue(arg: string) {
  return ["--format", "--token-limit", "--token-offset", "--network", "-n"].includes(arg);
}

function hasFormat(args: readonly string[]) {
  return args.some((arg) => arg === "--format" || arg.startsWith("--format="));
}

function isBooleanLiteral(value: string | undefined) {
  return value === "true" || value === "false";
}

function handleBuiltinSchema(args: readonly string[]) {
  if (!args.includes("--schema")) return false;

  const tokens = commandTokens(args);
  const [command, subcommand] = tokens;

  if (command === "mcp" && subcommand === "add") {
    printSchema({
      options: objectSchema({
        agent: stringSchema("Target a specific agent"),
        command: stringSchema("Override the command agents will run"),
        "no-global": booleanSchema("Install to project instead of globally"),
      }),
      output: objectSchema({
        agents: arraySchema(stringSchema()),
        command: stringSchema(),
        name: stringSchema(),
      }),
    });
    return true;
  }

  if (command === "skills" || command === "skill") {
    if (subcommand === "add") {
      printSchema({
        options: objectSchema({
          depth: numberSchema("Grouping depth for skill files"),
          "no-global": booleanSchema("Install to project instead of globally"),
        }),
        output: objectSchema({
          skills: arraySchema(stringSchema()),
        }),
      });
      return true;
    }

    if (subcommand === "list" || subcommand === "ls") {
      printSchema({
        output: arraySchema(
          objectSchema({
            description: stringSchema(),
            installed: booleanSchema(),
            name: stringSchema(),
          }),
        ),
      });
      return true;
    }
  }

  return false;
}

function commandTokens(args: readonly string[]) {
  const tokens: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg || arg === "--schema" || arg === "--help" || arg === "--llms" || arg === "--llms-full")
      continue;
    if (takesValue(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("--format=") || arg.startsWith("--token-limit=")) continue;
    if (arg.startsWith("-")) continue;
    tokens.push(arg);
  }
  return tokens;
}

function printSchema(schema: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

function stringSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "string",
  };
}

function numberSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "number",
  };
}

function booleanSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "boolean",
  };
}

function arraySchema(items: Record<string, unknown>) {
  return {
    type: "array",
    items,
  };
}

function describeCli() {
  return {
    name: "tempo wallet",
    about: "Wallet identity and custody operations",
    args: [
      option("network", "--network", 'Network to use (e.g. "testnet")', {
        short: "-n",
        global: true,
        valueName: "NETWORK",
      }),
      option("verbose", "--verbose", "Verbosity: repeat -v to increase (info, debug, trace)", {
        short: "-v",
        global: true,
        valueName: "VERBOSE",
      }),
      flag("silent", "--silent", "Silent mode: suppress non-essential output", {
        short: "-s",
        global: true,
      }),
      flag("json_output", "--json-output", "Quick switch for JSON output format", {
        short: "-j",
        global: true,
      }),
      flag(
        "toon_output",
        "--toon-output",
        "Quick switch for TOON output format (compact, token-efficient)",
        { short: "-t", global: true },
      ),
    ],
    subcommands: [
      {
        name: "login",
        about: "Sign up or log in to your Tempo wallet",
        args: [
          flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
          flag("wait", "--wait", "Wait for approval (default in a terminal)"),
          flag("no_wait", "--no-wait", "Return the code and URL for 'login status' immediately"),
        ],
        subcommands: [
          {
            name: "status",
            about: "Wait for a pending login's approval and finish it",
            args: [
              option("interval", "--interval", "Seconds between checks", {
                valueName: "SECONDS",
              }),
              option("max_attempts", "--max-attempts", "Checks before giving up", {
                valueName: "COUNT",
              }),
            ],
          },
        ],
      },
      {
        name: "refresh",
        about: "Refresh your access key without logging out",
        args: [flag("no_browser", "--no-browser", "Do not attempt to open a browser")],
      },
      {
        name: "logout",
        about: "Log out of every network, or of one with --network",
        args: [
          flag(
            "revoke",
            "--revoke",
            "Revoke the access keys on-chain through the wallet app before removing them",
          ),
          flag(
            "yes",
            "--yes",
            "Log out without a prompt when stored sessions hold unspent deposits or with --revoke",
          ),
          flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
        ],
      },
      {
        name: "whoami",
        about:
          "Show who you are: wallet, balances, keys (key.spending_limit is deprecated; use key.spending_limits)",
        args: [
          flag("mach", "--mach", "Show on-chain MACH balance"),
          flag("credits", "--credits", "Show existing MPP Credits balance (deprecated)"),
        ],
      },
      {
        name: "keys",
        about: "Manage access keys",
        subcommands: [
          {
            name: "list",
            about:
              "List keys and their spending limits (spending_limit is deprecated; use spending_limits)",
          },
          {
            name: "update",
            about: "Update an access key spending limit",
            args: [
              positional(
                "access_key",
                "Access key address (defaults to the only key for this wallet and network)",
              ),
              option("limit", "--limit", "New remaining limit in human token units", {
                valueName: "AMOUNT",
              }),
              option(
                "token",
                "--token",
                "Token address or symbol (defaults to current limit token)",
                { valueName: "TOKEN" },
              ),
              flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
            ],
          },
        ],
      },
      {
        name: "revoke",
        about: "Revoke an access key",
        args: [
          positional("access_key", "Access key address to revoke (0x...)"),
          flag("dry_run", "--dry-run", "Show the key that would be revoked without revoking it"),
          flag("yes", "--yes", "Revoke without a confirmation prompt"),
          flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
        ],
      },
      {
        name: "transfer",
        about: "Transfer tokens to an address",
        args: [
          positional(
            "amount",
            'Amount in human units ("1.00", "50") — required for token transfers',
          ),
          positional(
            "token",
            "Token address (0x...) or symbol (e.g. USDC.e) — required for token transfers",
          ),
          positional("to", "Recipient address (0x...)"),
          option(
            "fee_token",
            "--fee-token",
            "Pay fees in a different token, by address or symbol (default: the account's fee token, else the same token)",
            { valueName: "FEE_TOKEN" },
          ),
          flag("dry_run", "--dry-run", "Show plan, fee estimate, and balance; don't send"),
          flag("yes", "--yes", "Send without the confirmation prompt; required for agent runs"),
          flag("mach", "--mach", "Pay with on-chain MACH"),
          flag("credits", "--credits", "Spend existing MPP Credits (deprecated)"),
          option("max_spend", "--max-spend", "Maximum MACH spend in USD", { valueName: "AMOUNT" }),
          option(
            "amount_cents",
            "--amount-cents",
            "Credits amount or MPP challenge spending cap in USD cents",
            { valueName: "AMOUNT_CENTS" },
          ),
          option("credits_to", "--to", "Credits recipient; unsupported with MACH", {
            valueName: "CREDITS_TO",
          }),
          option("data", "--data", "Credits calldata; unsupported with MACH", {
            valueName: "DATA",
          }),
          option("value", "--value", "Credits ETH value (must be zero); unsupported with MACH", {
            valueName: "VALUE",
          }),
          option("mpp_challenge", "--mpp-challenge", "MPP WWW-Authenticate challenge", {
            valueName: "MPP_CHALLENGE",
          }),
          option(
            "mpp_challenge_file",
            "--mpp-challenge-file",
            "File containing an MPP WWW-Authenticate challenge",
            { valueName: "MPP_CHALLENGE_FILE" },
          ),
          option(
            "mpp_client_id",
            "--mpp-client-id",
            "Optional client ID to include in the generated MPP attribution memo",
            { valueName: "MPP_CLIENT_ID" },
          ),
          option("address", "--address", "Wallet address (defaults to current wallet)", {
            valueName: "ADDRESS",
          }),
        ],
      },
      {
        name: "swap",
        about: "Swap TIP-20 tokens on the Tempo Stablecoin DEX",
        args: [
          positional("amount", "Exact input amount by default; exact output with --exact-out"),
          positional("token_in", "Input token address (0x...) or symbol (e.g. USDC.e)"),
          positional("token_out", "Output token address (0x...) or symbol (e.g. pathUSD)"),
          flag("exact_out", "--exact-out", "Treat amount as the exact output amount"),
          option("slippage_bps", "--slippage-bps", "Maximum slippage in basis points", {
            valueName: "BPS",
          }),
          option(
            "min_amount_out",
            "--min-amount-out",
            "Exact input: refuse to receive less than this reviewed amount",
            { valueName: "AMOUNT" },
          ),
          option(
            "max_amount_in",
            "--max-amount-in",
            "Exact output: refuse to spend more than this reviewed amount",
            { valueName: "AMOUNT" },
          ),
          option("fee_token", "--fee-token", "Token address or symbol used to pay fees", {
            valueName: "FEE_TOKEN",
          }),
          flag("dry_run", "--dry-run", "Quote and show calls without submitting"),
          flag("yes", "--yes", "Confirm the reviewed swap for submission"),
        ],
      },
      {
        name: "fund",
        about: "Open add-funds flows in the wallet app",
        args: [
          option("address", "--address", "Wallet address to fund (defaults to current wallet)", {
            valueName: "ADDRESS",
          }),
          flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
          flag(
            "crypto",
            "--crypto",
            "Open the direct crypto funding flow (bridge on mainnet, faucet on testnet)",
          ),
          flag("mach", "--mach", "Open MACH funding"),
          flag("credits", "--credits", "Unavailable; use --mach to buy MACH"),
          option("amount", "--amount", "USD amount to prefill", { valueName: "AMOUNT" }),
          flag("wait", "--wait", "Wait for a balance increase; otherwise return immediately"),
          flag("no_wait", "--no-wait", "Return the funding handoff immediately (default)"),
          option("timeout", "--timeout", "Timeout in seconds with --wait (default: 600)", {
            valueName: "SECONDS",
          }),
          option("referral_code", "--referral-code", "Referral code to claim while funding", {
            valueName: "CODE",
          }),
        ],
        subcommands: [
          {
            name: "status",
            about: "Wait for a pending funding's balance increase",
            args: [
              option("interval", "--interval", "Seconds between balance checks", {
                valueName: "SECONDS",
              }),
              option("max_attempts", "--max-attempts", "Checks before giving up", {
                valueName: "COUNT",
              }),
            ],
          },
        ],
      },
      {
        name: "sessions",
        about: "Manage payment sessions",
        subcommands: [
          {
            name: "list",
            about: "List payment sessions",
            args: [
              flag("orphaned", "--orphaned", "Include on-chain orphaned discovery"),
              flag("all", "--all", "Include local sessions and orphaned discovery"),
            ],
          },
          {
            name: "close",
            about: "Request a session close, then withdraw after the grace period with --finalize",
            args: [
              positional("url", "URL, origin, or channel ID (0x...) to close"),
              flag("all", "--all", "Close all active sessions and on-chain channels"),
              flag("orphaned", "--orphaned", "Close only orphaned on-chain channels"),
              flag(
                "finalize",
                "--finalize",
                "Withdraw channels whose close grace period has ended",
              ),
              flag(
                "cooperative",
                "--cooperative",
                "Close now through the session's server instead of waiting out the grace period",
              ),
              flag("dry_run", "--dry-run", "Show what would be closed without executing"),
              flag(
                "yes",
                "--yes",
                "Close without the confirmation prompt; required for agent runs",
              ),
            ],
          },
          {
            name: "sync",
            about: "Sync local sessions with on-chain state",
            args: [
              option(
                "origin",
                "--origin",
                "Re-sync a specific origin's close state from on-chain",
                { valueName: "ORIGIN" },
              ),
            ],
          },
        ],
      },
      {
        name: "services",
        about: "Browse the MPP service directory",
        args: [
          positional("service_id", "Service ID to show details for"),
          option(
            "search",
            "--search",
            "Search by name, id, description, tags, or category; every word must match",
            { valueName: "QUERY" },
          ),
          flag(
            "refresh",
            "--refresh",
            "Fetch the service directory instead of using the cached copy",
          ),
        ],
      },
      {
        name: "mcp",
        about: "Register as MCP server",
        subcommands: [
          {
            name: "add",
            about: "Register as MCP server",
            args: [
              option("agent", "--agent", "Target a specific agent", { valueName: "AGENT" }),
              option("command", "--command", "Override the command agents will run", {
                short: "-c",
                valueName: "COMMAND",
              }),
              flag("no_global", "--no-global", "Install to project instead of globally"),
            ],
          },
        ],
      },
      {
        name: "skills",
        about: "Sync skill files to agents",
        aliases: ["skill"],
        subcommands: [
          {
            name: "add",
            about: "Sync skill files to agents",
            args: [
              option("depth", "--depth", "Grouping depth for skill files", {
                valueName: "DEPTH",
              }),
              flag("no_global", "--no-global", "Install to project instead of globally"),
            ],
          },
          { name: "list", about: "List skills", aliases: ["ls"] },
        ],
      },
      { name: "doctor", about: "Diagnose login, access key, RPC, sqlite3, and environment setup" },
      { name: "debug", about: "Deprecated: use 'doctor'" },
    ],
  };
}

function positional(name: string, help: string) {
  return { name, help, type: "positional" };
}

function flag(
  name: string,
  long: string,
  help: string,
  options: { global?: boolean | undefined; short?: string | undefined } = {},
) {
  return {
    name,
    ...(options.short ? { short: options.short } : {}),
    long,
    help,
    ...(options.global ? { global: true } : {}),
    type: "option",
    value_name: name.toUpperCase(),
    possible_values: ["true", "false"],
  };
}

function option(
  name: string,
  long: string,
  help: string,
  options: {
    global?: boolean | undefined;
    short?: string | undefined;
    valueName?: string | undefined;
  } = {},
) {
  return {
    name,
    ...(options.short ? { short: options.short } : {}),
    long,
    help,
    ...(options.global ? { global: true } : {}),
    type: "option",
    value_name: options.valueName ?? name.toUpperCase(),
  };
}
