#!/usr/bin/env node
import { Cli, Completions, Mcp, type z } from "incur";

import { bindOptionValues } from "./shared/argv.js";
import { version } from "./shared/constants.js";
import { usageError } from "./shared/errors.js";
import { withWallet } from "./shared/require-wallet.js";
import {
  completionsHandler,
  keysHandler,
  logoutHandler,
  refreshHandler,
  revokeHandler,
  updateAccessKeyHandler,
  whoamiHandler,
} from "./commands/identity.js";
import { debugHandler, doctorHandler } from "./commands/doctor.js";
import { loginHandler, loginStatusHandler } from "./commands/login.js";
import { swapTokens } from "./commands/swap.js";
import { transferCredits, transferMach, transferTokens } from "./commands/transfer.js";
import { fundAction, runFundingFlow } from "./commands/fund.js";
import {
  closeSessions,
  dryRunCloseSessions,
  listSessions,
  syncSessions,
} from "./commands/sessions.js";
import { fetchServiceList, fetchServices, staleListFetchedAt } from "./commands/services.js";
import { completionScript } from "./completions.js";
import {
  cliGlobalAlias,
  cliGlobals,
  completionsArgs,
  completionsOutput,
  doctorOutput,
  fundOptions,
  fundOutput,
  globalAlias,
  globalOptions,
  keysOutput,
  loginOptions,
  loginOutput,
  loginStatusOptions,
  loginStatusOutput,
  logoutOptions,
  logoutOutput,
  refreshOptions,
  refreshOutput,
  revokeArgs,
  revokeOptions,
  revokeOutput,
  updateAccessKeyOptions,
  updateAccessKeyOutput,
  updateAccessKeyArgs,
  servicesArgs,
  servicesMcpOutput,
  servicesOutput,
  servicesOptions,
  sessionsCloseArgs,
  sessionsCloseCommandOutput,
  sessionsCloseOptions,
  sessionsListOptions,
  sessionsListOutput,
  sessionsSyncOptions,
  swapArgs,
  swapOptions,
  swapOutput,
  transferArgs,
  transferOptions,
  transferOutput,
  whoamiOptions,
  whoamiOutput,
} from "./schemas.js";

let closeCommandFailed = false;

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

// Bare `tempo wallet login` starts a login; `login status` finishes a pending one.
const login = Cli.create("login", {
  description: "Sign up or log in to your Tempo wallet",
  globals: cliGlobals,
  options: loginOptions,
  alias: globalAlias,
  output: loginOutput,
  async run({ agent, error, globals, options }) {
    const result = await loginHandler({
      ...options,
      network: globals.network,
      // Agents get the code and URL back at once; a terminal waits for approval.
      wait: options.wait ?? !agent,
    });
    return "code" in result ? error(result) : result;
  },
});

login.command("status", {
  description: "Wait for a pending login's approval and finish it",
  options: loginStatusOptions,
  alias: globalAlias,
  output: loginStatusOutput,
  async run({ error, globals, options }) {
    const result = await loginStatusHandler({
      network: globals.network,
      interval: options.interval,
      maxAttempts: options["max-attempts"],
    });
    return "code" in result ? error(result) : result;
  },
});

cli.command(login);

cli.command("refresh", {
  description: "Refresh your access key without logging out",
  options: refreshOptions,
  alias: globalAlias,
  output: refreshOutput,
  async run({ globals, options }) {
    return refreshHandler({ ...options, network: globals.network });
  },
});

cli.command("logout", {
  description: "Log out and disconnect your wallet",
  options: logoutOptions,
  alias: globalAlias,
  output: logoutOutput,
  async run() {
    return logoutHandler();
  },
});

cli.command("whoami", {
  description: "Show who you are: wallet, balances, keys",
  options: whoamiOptions,
  alias: globalAlias,
  output: whoamiOutput,
  async run({ globals, options }) {
    return whoamiHandler({ ...options, network: globals.network });
  },
});

// Mounted groups share the root globals; declaring them types `globals` in their commands.
const keys = Cli.create("keys", {
  description: "Manage access keys",
  globals: cliGlobals,
});

keys.command("list", {
  description: "List keys and their spending limits",
  options: globalOptions,
  alias: globalAlias,
  output: keysOutput,
  async run({ globals }) {
    return keysHandler(globals);
  },
});

keys.command("update", {
  description: "Update an access key spending limit",
  args: updateAccessKeyArgs,
  options: updateAccessKeyOptions,
  alias: globalAlias,
  output: updateAccessKeyOutput,
  // The wallet app approves the new limit, so an expired or unusable key can still be limited.
  run: withWallet(
    ({ args, options }, wallet) =>
      updateAccessKeyHandler(wallet, { ...options, accessKey: args.accessKey }),
    { requireKey: "never" },
  ),
});

cli.command(keys);

cli.command("revoke", {
  description: "Revoke an access key",
  args: revokeArgs,
  options: revokeOptions,
  alias: globalAlias,
  output: revokeOutput,
  // The wallet app signs the revocation, so the local access key need not be usable.
  run: withWallet(
    (context, wallet) => revokeHandler(wallet, context.args, context.options, context),
    { requireKey: "never" },
  ),
});

cli.command("transfer", {
  description: "Transfer tokens to an address",
  args: transferArgs,
  options: transferOptions,
  alias: globalAlias,
  output: transferOutput,
  examples: [
    { args: { amount: "1.00", token: "USDC.e", to: "0x70997...9C8" } },
    {
      args: { amount: "50", token: "0x20c0...b50", to: "0x70997...9C8" },
      options: { "dry-run": true },
    },
    { options: { mach: true, "max-spend": "5", "mpp-challenge": "<WWW_AUTHENTICATE>" } },
  ],
  async run(context) {
    const { args, globals, options } = context;
    const flags = { ...options, network: globals.network };
    if (options.credits && options.mach) throw usageError("Use only one of --credits and --mach");
    if (options.credits) {
      // MCP puts the shared `to` field in args; a CLI positional recipient needs amount and token.
      if (args.amount !== undefined || args.token !== undefined)
        throw usageError(
          "Positional amount, token, and recipient arguments cannot be used with --credits; use --amount-cents and --to, or an MPP challenge",
        );
      // Credits are signed by the wallet app, not the local access key.
      return transferCredits({ options: { ...flags, to: options.to ?? args.to } });
    }
    // A TEMPO_PRIVATE_KEY payer stands in for the logged-in wallet.
    if (options.mach && process.env.TEMPO_PRIVATE_KEY) return transferMach({ options: flags });
    // MACH pays with the stored access key; a token transfer without one, run interactively,
    // is approved in the wallet app instead.
    return withWallet(
      async (_, wallet) =>
        options.mach
          ? transferMach({ options: { ...flags, network: wallet.network.name } })
          : transferTokens(wallet, { args, options }),
      { requireKey: options.mach ? "always" : "agent" },
    )(context);
  },
});

cli.command("swap", {
  description: "Swap TIP-20 tokens on the Tempo Stablecoin DEX",
  args: swapArgs,
  options: swapOptions,
  alias: globalAlias,
  output: swapOutput,
  examples: [
    {
      args: { amount: "10", tokenIn: "USDC.e", tokenOut: "pathUSD" },
      options: { "dry-run": true },
    },
  ],
  // A refusal that needs a login on the selected network is returned, keeping its `cta`.
  run: withWallet(
    async ({ args, error, options }, wallet) => {
      const result = await swapTokens(wallet, { args, options });
      return "code" in result ? error(result) : result;
    },
    { requireKey: "agent" },
  ),
});

cli.command("fund", {
  description: "Open add-funds flows in the wallet app",
  options: fundOptions,
  alias: globalAlias,
  output: fundOutput,
  async run({ globals, options }) {
    return runFundingFlow({
      action: fundAction({
        credits: options.credits,
        mach: options.mach,
        crypto: options.crypto,
        referralCode: options["referral-code"] ?? options.claim,
      }),
      address: options.address,
      code: options["referral-code"] ?? options.claim,
      noBrowser: options.browser === false,
      noWait: options.wait === false,
      amount: options.amount,
      timeout: options.timeout,
      network: globals.network,
    });
  },
});

// Bare `tempo wallet sessions` lists sessions.
const sessions = Cli.create("sessions", {
  description: "Manage payment sessions",
  globals: cliGlobals,
  options: sessionsListOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ globals, options }) {
    return listSessions({ all: options.all, network: globals.network, orphaned: options.orphaned });
  },
});

sessions.command("list", {
  description: "List payment sessions",
  options: sessionsListOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ globals, options }) {
    return listSessions({ all: options.all, network: globals.network, orphaned: options.orphaned });
  },
});

sessions.command("close", {
  description: "Request a session close, then withdraw after the grace period with --finalize",
  args: sessionsCloseArgs,
  options: sessionsCloseOptions,
  alias: globalAlias,
  output: sessionsCloseCommandOutput,
  // Close and withdraw transactions fall back to wallet app approval, so channel funds stay
  // recoverable without a usable access key.
  run: withWallet(
    async ({ args, options }, wallet) => {
      const close = {
        all: options.all,
        cooperative: options.cooperative,
        finalize: options.finalize,
        orphaned: options.orphaned,
        target: args.url,
      };
      if (options["dry-run"]) return dryRunCloseSessions(wallet, close);
      const summary = await closeSessions(wallet, close);
      closeCommandFailed = summary.failed > 0;
      return summary;
    },
    { requireKey: "never" },
  ),
});

sessions.command("sync", {
  description: "Sync local sessions with on-chain state",
  options: sessionsSyncOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ globals, options }) {
    return syncSessions({ network: globals.network, origin: options.origin });
  },
});

cli.command(sessions);

cli.command("services", {
  description: "Browse the MPP service directory",
  args: servicesArgs,
  options: servicesOptions,
  alias: globalAlias,
  output: servicesOutput,
  async run({ args, options }) {
    if (args.serviceId === "list" && !options.search)
      return fetchServiceList({ refresh: options.refresh });
    return fetchServices({
      refresh: options.refresh,
      search: options.search,
      serviceId: args.serviceId === "list" ? undefined : args.serviceId,
    });
  },
});

cli.command("doctor", {
  description: "Diagnose login, access key, RPC, sqlite3, and environment setup",
  options: globalOptions,
  alias: globalAlias,
  output: doctorOutput,
  async run({ globals }) {
    return doctorHandler(globals);
  },
});

cli.command("debug", {
  description: "Deprecated: use 'doctor'",
  options: globalOptions,
  alias: globalAlias,
  output: doctorOutput,
  async run({ globals }) {
    return debugHandler(globals);
  },
});

cli.command("completions", {
  description: "Generate shell completions script",
  args: completionsArgs,
  options: globalOptions,
  alias: globalAlias,
  output: completionsOutput,
  run() {
    return completionsHandler();
  },
});

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const nonDestructive = { readOnlyHint: false, destructiveHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true };

/**
 * MCP tool annotations by tool name, so clients can tell reads from spends. Refreshing the
 * service directory cache is a read; storing discovered sessions is an additive change. Moving
 * funds, changing or revoking a key, closing a session, and deleting stored sessions or the
 * stored wallet are destructive. `openWorldHint` marks tools that reach the chain RPC, the wallet
 * app, or another server.
 */
const mcpToolHints: Record<string, Mcp.ToolAnnotations> = {
  completions: { ...readOnly, openWorldHint: false },
  debug: { ...readOnly, openWorldHint: true },
  doctor: { ...readOnly, openWorldHint: true },
  // Opens a wallet-app checkout; any payment happens there, not in this command.
  fund: { ...nonDestructive, idempotentHint: false, openWorldHint: true },
  keys_list: { ...readOnly, openWorldHint: true },
  keys_update: { ...destructive, idempotentHint: false, openWorldHint: true },
  login: { ...nonDestructive, idempotentHint: false, openWorldHint: true },
  login_status: { ...nonDestructive, idempotentHint: true, openWorldHint: true },
  logout: { ...destructive, idempotentHint: true, openWorldHint: false },
  refresh: { ...nonDestructive, idempotentHint: false, openWorldHint: true },
  revoke: { ...destructive, idempotentHint: true, openWorldHint: true },
  services: { ...readOnly, openWorldHint: true },
  sessions_close: { ...destructive, idempotentHint: false, openWorldHint: true },
  // With `all` or `orphaned`, stores channels discovered on-chain that were not stored yet.
  sessions_list: { ...nonDestructive, idempotentHint: true, openWorldHint: true },
  // Deletes stored sessions whose channel the chain shows finalized or does not hold.
  sessions_sync: { ...destructive, idempotentHint: true, openWorldHint: true },
  swap: { ...destructive, idempotentHint: false, openWorldHint: true },
  transfer: { ...destructive, idempotentHint: false, openWorldHint: true },
  whoami: { ...readOnly, openWorldHint: true },
};

void main();

export default cli;

function walletCommands() {
  // incur keys this map by the default Cli type; the globals generic does not change the entry.
  const commands = Cli.toCommands.get(cli as never);
  if (!commands) throw new Error("Unable to access wallet commands");
  return commands as Map<string, unknown>;
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
 * Each tool also declares its `mcpToolHints` entry, found by the tool name incur gives it
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
    mcp: { annotations: mcpToolHints[path.join("_")] },
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
        about: "Log out and disconnect your wallet",
        args: [flag("yes", "--yes", "Skip confirmation prompt")],
      },
      {
        name: "whoami",
        about: "Show who you are: wallet, balances, keys",
        args: [
          flag("mach", "--mach", "Show on-chain MACH balance"),
          flag("credits", "--credits", "Show existing MPP Credits balance (deprecated)"),
        ],
      },
      {
        name: "keys",
        about: "Manage access keys",
        subcommands: [
          { name: "list", about: "List keys and their spending limits" },
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
            "Pay fees in a different token, by address or symbol (default: same token)",
            { valueName: "FEE_TOKEN" },
          ),
          flag("dry_run", "--dry-run", "Show plan + fee estimate, don't send"),
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
