/** A command's `--describe` entry. */
export type Describe = {
  name: string;
  about: string;
  aliases?: string[] | undefined;
  args?: DescribeArg[] | undefined;
  subcommands?: Describe[] | undefined;
};

type DescribeArg =
  | ReturnType<typeof positional>
  | ReturnType<typeof flag>
  | ReturnType<typeof option>;

/** `tempo wallet --describe`: the global args, then each command's entry in order. */
export function describeCli(commands: readonly { describe?: Describe | undefined }[]) {
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
    subcommands: commands.flatMap(({ describe }) => (describe ? [describe] : [])),
  };
}

export function positional(name: string, help: string) {
  return { name, help, type: "positional" };
}

export function flag(
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

export function option(
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
