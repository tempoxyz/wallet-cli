import { Cli } from "incur";
import { encodeQR } from "qr";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { addressOptions, addressOutput } from "../schemas/address.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { networkFields } from "../shared/network.js";
import { withWallet, type Wallet } from "../shared/require-wallet.js";

export default {
  command: Cli.create("address", {
    description: "Show the wallet address",
    globals: cliGlobals,
    options: addressOptions,
    alias: globalAlias,
    output: addressOutput,
    // The address is in the wallet store, so only the account is required.
    async run(context) {
      return withWallet((_, wallet) => addressHandler(wallet, context.options, context), {
        requireKey: "never",
      })(context);
    },
  }),
  annotations: { address: { ...readOnly, openWorldHint: false } },
} satisfies WalletCommand;

/**
 * The logged-in wallet's address. With `qr` on a terminal run, a QR code of it is printed first
 * for a phone to scan. Agent runs get the same output without one: the code only renders the
 * address, which the output already holds.
 */
export function addressHandler(
  { account, network }: Wallet,
  options: { qr?: boolean | undefined },
  { agent }: { agent: boolean },
) {
  const address = account.address.toLowerCase();
  // `term` sets each module's background, so it scans in light and dark terminal themes alike.
  if (options.qr && !agent) process.stdout.write(encodeQR(address, "term"));
  return { address, ...networkFields(network.chainId) };
}
