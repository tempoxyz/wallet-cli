#!/usr/bin/env node
import { Cli } from "incur";

import { version } from "./shared/constants.js";
import {
  completionsHandler,
  debugHandler,
  keysHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  whoamiHandler,
} from "./commands/identity.js";
import { transferCredits, transferTokens } from "./commands/transfer.js";
import { fundAction, runFundingFlow } from "./commands/fund.js";
import {
  closeSessions,
  dryRunCloseSessions,
  listSessions,
  syncSessions,
} from "./commands/sessions.js";
import { fetchServiceList, fetchServices } from "./commands/services.js";
import { handleCompatCommand } from "./compat.js";
import {
  completionsArgs,
  completionsOutput,
  debugOutput,
  fundOptions,
  fundOutput,
  globalAlias,
  globalOptions,
  keysOutput,
  loginOptions,
  loginOutput,
  logoutOptions,
  logoutOutput,
  refreshOutput,
  servicesArgs,
  servicesOutput,
  servicesOptions,
  sessionsCloseArgs,
  sessionsCloseCommandOutput,
  sessionsCloseOptions,
  sessionsListOptions,
  sessionsListOutput,
  sessionsSyncOptions,
  transferArgs,
  transferOptions,
  transferOutput,
  whoamiOptions,
  whoamiOutput,
} from "./schemas.js";

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
});

cli.command("login", {
  description: "Sign up or log in to your Tempo wallet",
  options: loginOptions,
  alias: globalAlias,
  output: loginOutput,
  async run({ options }) {
    return loginHandler(options);
  },
});

cli.command("refresh", {
  description: "Refresh your access key without logging out",
  options: globalOptions,
  alias: globalAlias,
  output: refreshOutput,
  async run({ options }) {
    return refreshHandler(options);
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
  async run({ options }) {
    return whoamiHandler(options);
  },
});

cli.command("keys", {
  description: "List keys and their spending limits",
  options: globalOptions,
  alias: globalAlias,
  output: keysOutput,
  async run() {
    return keysHandler();
  },
});

cli.command("transfer", {
  description: "Transfer tokens to an address",
  args: transferArgs,
  options: transferOptions,
  alias: globalAlias,
  output: transferOutput,
  examples: [
    { args: { amount: "1.00", token: "0x20c0...b50", to: "0x70997...9C8" } },
    {
      args: { amount: "50", token: "0x20c0...b50", to: "0x70997...9C8" },
      options: { "dry-run": true },
    },
    { options: { credits: true, "amount-cents": 500, to: "0x20c0...b50" } },
    { options: { credits: true, "mpp-challenge": "<WWW_AUTHENTICATE>" } },
  ],
  async run({ args, options }) {
    if (!options.credits) return transferTokens({ args, options });

    return transferCredits({ options });
  },
});

cli.command("fund", {
  description: "Open add-funds flows in the wallet app",
  options: fundOptions,
  alias: globalAlias,
  output: fundOutput,
  async run({ options }) {
    return runFundingFlow({
      action: fundAction({
        credits: options.credits,
        crypto: options.crypto,
        referralCode: options["referral-code"] ?? options.claim,
      }),
      address: options.address,
      code: options["referral-code"] ?? options.claim,
      noBrowser: options.browser === false,
      network: options.network,
    });
  },
});

const sessions = Cli.create("sessions", {
  description: "Manage payment sessions",
});

sessions.command("list", {
  description: "List payment sessions",
  options: sessionsListOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ options }) {
    return listSessions({ all: options.all, network: options.network, orphaned: options.orphaned });
  },
});

sessions.command("close", {
  description: "Close a payment session and remove it locally",
  args: sessionsCloseArgs,
  options: sessionsCloseOptions,
  alias: globalAlias,
  output: sessionsCloseCommandOutput,
  async run({ args, options }) {
    if (options["dry-run"])
      return dryRunCloseSessions({
        all: options.all,
        cooperative: options.cooperative,
        finalize: options.finalize,
        network: options.network,
        orphaned: options.orphaned,
        target: args.url,
      });
    return closeSessions({
      all: options.all,
      cooperative: options.cooperative,
      finalize: options.finalize,
      network: options.network,
      orphaned: options.orphaned,
      target: args.url,
    });
  },
});

sessions.command("sync", {
  description: "Sync local sessions with on-chain state",
  options: sessionsSyncOptions,
  alias: globalAlias,
  output: sessionsListOutput,
  async run({ options }) {
    return syncSessions({ network: options.network, origin: options.origin });
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
    if (args.serviceId === "list" && !options.search) return fetchServiceList();
    return fetchServices({
      search: options.search,
      serviceId: args.serviceId === "list" ? undefined : args.serviceId,
    });
  },
});

cli.command("debug", {
  description: "Collect debug info for support",
  options: globalOptions,
  alias: globalAlias,
  output: debugOutput,
  async run({ options }) {
    return debugHandler(options);
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

void main();

export default cli;

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--describe")) {
    process.stdout.write(`${JSON.stringify(describeCli())}\n`);
    process.exit(0);
  }

  const args = normalizeServicesOutputAliases(rawArgs);

  if (handleBuiltinSchema(args)) process.exit(0);

  if (await handleCompatCommand(args)) process.exit(0);

  await cli.serve(args);
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
    if (arg === "--format" || arg === "--token-limit" || arg === "--token-offset") {
      index++;
      continue;
    }
    if (arg.startsWith("--format=") || arg.startsWith("--token-limit=")) continue;
    if (arg.startsWith("-")) continue;
    return index;
  }
  return undefined;
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
    if (arg === "--format" || arg === "--token-limit" || arg === "--token-offset") {
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
        args: [flag("no_browser", "--no-browser", "Do not attempt to open a browser")],
      },
      { name: "refresh", about: "Refresh your access key without logging out" },
      {
        name: "logout",
        about: "Log out and disconnect your wallet",
        args: [flag("yes", "--yes", "Skip confirmation prompt")],
      },
      {
        name: "whoami",
        about: "Show who you are: wallet, balances, keys",
        args: [flag("credits", "--credits", "Show Coinflow credits balance")],
      },
      { name: "keys", about: "List keys and their spending limits" },
      {
        name: "transfer",
        about: "Transfer tokens to an address",
        args: [
          positional(
            "amount",
            'Amount in human units ("1.00", "50") — required for token transfers',
          ),
          positional("token", "Token contract address (0x...) — required for token transfers"),
          positional("to", "Recipient address (0x...)"),
          option(
            "fee_token",
            "--fee-token",
            "Pay fees in a different token (default: same token)",
            { valueName: "FEE_TOKEN" },
          ),
          flag("dry_run", "--dry-run", "Show plan + fee estimate, don't send"),
          flag("credits", "--credits", "Pay with Coinflow credits instead of tokens"),
          option(
            "amount_cents",
            "--amount-cents",
            "Amount in USD cents when using --credits (e.g. 500 = $5.00)",
            { valueName: "AMOUNT_CENTS" },
          ),
          option("credits_to", "--to", "Recipient address when using --credits (0x...)", {
            valueName: "CREDITS_TO",
          }),
          option("data", "--data", "Calldata hex when using --credits (0x...)", {
            valueName: "DATA",
          }),
          option("value", "--value", "ETH value in wei when using --credits (default: 0)", {
            valueName: "VALUE",
          }),
          option(
            "mpp_challenge",
            "--mpp-challenge",
            "MPP WWW-Authenticate challenge when using --credits",
            { valueName: "MPP_CHALLENGE" },
          ),
          option(
            "mpp_challenge_file",
            "--mpp-challenge-file",
            "File containing an MPP WWW-Authenticate challenge when using --credits",
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
          flag("credits", "--credits", "Open the credits purchase flow"),
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
            about: "Close a payment session and remove it locally",
            args: [
              positional("url", "URL, origin, or channel ID (0x...) to close"),
              flag("all", "--all", "Close all active sessions and on-chain channels"),
              flag("orphaned", "--orphaned", "Close only orphaned on-chain channels"),
              flag("finalize", "--finalize", "Finalize channels pending close"),
              flag("cooperative", "--cooperative", "Use cooperative close only"),
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
          option("search", "--search", "Search by name, description, tags, or category", {
            valueName: "QUERY",
          }),
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
      { name: "debug", about: "Collect debug info for support" },
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
