import { loadWalletState } from "./wallet/store.js";
import { currentWhoamiOutput } from "./commands/identity.js";
import { fundAction, runFundingFlow } from "./commands/fund.js";
import { listSessions } from "./commands/sessions.js";
import { fetchServices } from "./commands/services.js";

export async function handleCompatCommand(args: readonly string[]) {
  if (args[0] === "help") {
    printCompatHelp();
    return true;
  }
  if (args.includes("--help") || args.includes("-h")) return false;

  const command = args.find((arg) => !arg.startsWith("-"));
  if (command === "completions" && printCompletions(args)) return true;

  if (command === "login" && args.includes("--no-browser")) {
    const state = await loadWalletState();
    const activeAccount = state.accounts[state.activeAccount ?? 0];
    if (!activeAccount) return false;
    printCompatOutput(
      currentWhoamiOutput({
        walletAddress: activeAccount.address,
        chain: state.chainId ?? null,
        accessKeys: state.accessKeys,
      }),
      args,
    );
    return true;
  }

  if (command === "fund") {
    try {
      await runFundCompat(args);
    } catch (error) {
      printCompatErrorAndExit(error, args);
    }
    return true;
  }

  if (command !== "sessions" && command !== "services") return false;

  const commandIndex = args.indexOf(command);
  const rest = args.slice(commandIndex + 1);
  const subcommand = rest.find((arg) => !arg.startsWith("-") && isSubcommand(command, arg));
  if (subcommand) return false;

  if (command === "sessions") {
    printCompatOutput(
      await listSessions({ network: stringArg(args, "--network") ?? stringArg(args, "-n") }),
      args,
    );
    return true;
  }

  try {
    printCompatOutput(
      await fetchServices({ search: stringArg(args, "--search"), serviceId: serviceIdArg(args) }),
      args,
    );
  } catch (error) {
    printCompatErrorAndExit(error, args);
  }
  return true;
}

async function runFundCompat(args: readonly string[]) {
  const result = await runFundingFlow({
    action: fundAction({
      credits: args.includes("--credits"),
      crypto: args.includes("--crypto"),
      referralCode: stringArg(args, "--referral-code") ?? stringArg(args, "--claim"),
    }),
    address: stringArg(args, "--address"),
    code: stringArg(args, "--referral-code") ?? stringArg(args, "--claim"),
    noBrowser: args.includes("--no-browser"),
  });
  printCompatOutput(result, args);
}

function stringArg(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("-") ? value : undefined;
}

function serviceIdArg(args: readonly string[]) {
  const commandIndex = args.indexOf("services");
  if (commandIndex < 0) return undefined;

  for (let index = commandIndex + 1; index < args.length; index++) {
    const value = args[index];
    if (!value) continue;
    if (value === "--search" || value === "--network" || value === "-n" || value === "--format") {
      index++;
      continue;
    }
    if (value.startsWith("-")) continue;
    if (isSubcommand("services", value)) continue;
    return value;
  }

  return undefined;
}

function printCompatHelp() {
  console.log(`Wallet identity and custody operations

Usage: tempo wallet <command>

Commands:
  login     Sign up or log in to your Tempo wallet
  refresh   Refresh your access key without logging out
  logout    Log out and disconnect your wallet
  whoami    Show who you are: wallet, balances, keys
  keys      List keys and their spending limits
  transfer  Transfer tokens to an address
  fund      Open add-funds flows in the wallet app
  sessions  Manage payment sessions
  services  Browse the MPP service directory
  debug     Collect debug info for support

Options:
  --help     Show help
  --version  Show version`);
}

function printCompletions(args: readonly string[]) {
  const shell = args[args.indexOf("completions") + 1];
  if (!shell || shell.startsWith("-")) {
    console.log("Supported shells: bash, zsh, fish, powershell, elvish");
    return true;
  }

  if (shell === "powershell") {
    console.log(powershellCompletions());
    return true;
  }

  if (shell === "elvish") {
    console.log(elvishCompletions());
    return true;
  }

  return false;
}

function powershellCompletions() {
  return `using namespace System.Management.Automation
using namespace System.Management.Automation.Language

Register-ArgumentCompleter -Native -CommandName 'tempo wallet' -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @('login', 'refresh', 'logout', 'whoami', 'keys', 'transfer', 'fund', 'sessions', 'services', 'debug', 'completions', 'help')
    $options = @('-n', '--network', '-v', '--verbose', '-s', '--silent', '-j', '--json-output', '-t', '--toon-output', '-h', '--help', '-V', '--version')
    @($commands + $options) |
        Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object { [CompletionResult]::new($_, $_, [CompletionResultType]::ParameterValue, $_) }
}`;
}

function elvishCompletions() {
  return `use builtin;
use str;

set edit:completion:arg-completer[tempo wallet] = {|@words|
    fn cand {|text desc| edit:complex-candidate $text &display=$text' '$desc }
    var command = 'tempo wallet'
    var completions = [
        &'tempo wallet'= {
            cand login 'Sign up or log in to your Tempo wallet'
            cand refresh 'Refresh your access key without logging out'
            cand logout 'Log out and disconnect your wallet'
            cand whoami 'Show who you are: wallet, balances, keys'
            cand keys 'List keys and their spending limits'
            cand transfer 'Transfer tokens to an address'
            cand fund 'Open add-funds flows in the wallet app'
            cand sessions 'Manage payment sessions'
            cand services 'Browse the MPP service directory'
            cand debug 'Collect debug info for support'
            cand completions 'Generate shell completions script'
            cand help 'Print this message or the help of the given subcommand(s)'
            cand --network 'Network to use (e.g. "testnet")'
            cand --json-output 'Quick switch for JSON output format'
            cand --toon-output 'Quick switch for TOON output format'
        }
    ]
    $completions[$command]
}`;
}

function isSubcommand(command: "sessions" | "services", value: string) {
  if (command === "sessions") return value === "list" || value === "close" || value === "sync";
  return value === "list";
}

function printCompatOutput(value: unknown, args: readonly string[]) {
  if (args.includes("--json-output") || args.includes("--format")) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function printCompatErrorAndExit(error: unknown, args: readonly string[]): never {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "E_RUNTIME";
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : 1;

  if (args.includes("--json-output") || args.includes("--format")) {
    console.log(JSON.stringify({ code, message }));
  } else {
    console.error(message);
  }
  process.exit(exitCode);
}
