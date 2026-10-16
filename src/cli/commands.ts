import address from "../commands/address.js";
import balance from "../commands/balance.js";
import completions from "../commands/completions.js";
import config from "../commands/config.js";
import debug from "../commands/debug.js";
import doctor from "../commands/doctor.js";
import fund from "../commands/fund.js";
import keys from "../commands/keys.js";
import login from "../commands/login.js";
import logout from "../commands/logout.js";
import refresh from "../commands/refresh.js";
import revoke from "../commands/revoke.js";
import services from "../commands/services/index.js";
import sessions from "../commands/sessions/index.js";
import swap from "../commands/swap.js";
import transfer from "../commands/transfer/index.js";
import tx from "../commands/tx.js";
import whoami from "../commands/whoami.js";
import { mcp, skills } from "./builtins.js";
import type { WalletCommand } from "./command.js";

// `--describe` lists these in this order. Shell completions offer the mounted commands in the
// same order, then incur's builtin `mcp` and `skills`, which incur mounts itself.
export const commands: WalletCommand[] = [
  login,
  refresh,
  logout,
  whoami,
  balance,
  address,
  keys,
  revoke,
  transfer,
  swap,
  tx,
  fund,
  sessions,
  services,
  mcp,
  skills,
  config,
  doctor,
  debug,
  completions,
];
