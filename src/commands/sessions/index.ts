import { Cli } from "incur";

import type { WalletCommand } from "../../cli/command.js";
import { sessionsListOptions, sessionsListOutput } from "../../schemas/sessions.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { closeAnnotations, closeCommand, closeDescribe } from "./close.js";
import { listAnnotations, listCommand, listDescribe, listSessions } from "./list.js";
import { syncAnnotations, syncCommand, syncDescribe } from "./sync.js";

// Bare `tempo wallet sessions` lists sessions.
export default {
  command: Cli.create("sessions", {
    description: "Manage payment sessions",
    globals: cliGlobals,
    options: sessionsListOptions,
    alias: globalAlias,
    output: sessionsListOutput,
    async run({ globals, options }) {
      return listSessions({
        all: options.all,
        network: globals.network,
        orphaned: options.orphaned,
      });
    },
  })
    .command("list", listCommand)
    .command("close", closeCommand)
    .command("sync", syncCommand),
  annotations: {
    sessions_close: closeAnnotations,
    sessions_list: listAnnotations,
    sessions_sync: syncAnnotations,
  },
  describe: {
    name: "sessions",
    about: "Manage payment sessions",
    subcommands: [listDescribe, closeDescribe, syncDescribe],
  },
} satisfies WalletCommand;
