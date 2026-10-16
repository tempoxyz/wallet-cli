import type { tempo } from "mppx/client";
import { machineTokenDeployments } from "mppx/tempo";
import { erc20Abi, HttpRequestError, TimeoutError, type Address } from "viem";
import { call, readContract } from "viem/actions";
import { Transaction as TempoTransaction } from "viem/tempo";

import { CtaError } from "../cli/incur-compat.js";
import { commandError, networkError, paymentError, walletError } from "../shared/errors.js";
import { machToken } from "../shared/mach.js";
import { createTempoPublicClient, type Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { stringValue } from "../shared/utils.js";
import { accessKeyLimitError } from "../wallet/access-key.js";
import type { WalletState } from "../wallet/store.js";
import { requestNetwork, storedAccessKeyLimit } from "./identity.js";
import type { RequestOptions } from "./options.js";
import { formatTokenAmount } from "./spend.js";

export function isMachPaymentToken(token: string | undefined) {
  return (
    token !== undefined &&
    (token.toLowerCase() === "mach" ||
      Object.values(machineTokenDeployments).some(
        (deployment) => deployment.token.toLowerCase() === token.toLowerCase(),
      ))
  );
}

export type ChargeParameters = NonNullable<Parameters<typeof tempo.charge>[0]>;

/**
 * Holds an explicit MACH selection to the canonical SDK route, so it never silently spends
 * stablecoins. When the route cannot pay `payment.amount`, the error names the cause: the access
 * key's stored MACH limit is below it, its stored call scopes leave out a route call, the payer's
 * MACH balance is below it, or else the route did not simulate.
 */
export function machChargeParameters(
  options: RequestOptions,
  payment: { amount: bigint; key?: WalletState["accessKeys"][number] | undefined },
): ChargeParameters {
  if (!isMachPaymentToken(options.paymentToken)) return {};
  const network = requestNetwork(options);
  // machToken refuses a chain without a MACH deployment.
  const token = machToken(network.chainId).toLowerCase();
  const deployment =
    machineTokenDeployments[network.chainId as keyof typeof machineTokenDeployments];
  const swapper = deployment.swap.toLowerCase();
  const { key } = payment;
  const limit = storedAccessKeyLimit(key, token);
  // The SDK resolves the route's calls first, and the direct transfer only once it gives up on
  // the route; that second call reports why, checking the route's calls again.
  let route: readonly MachRouteCall[] | undefined;
  return {
    autoSwap: false,
    async resolveAccount({ account, chainId, operation }) {
      const calls = operation.kind === "executeCalls" ? operation.calls : undefined;
      const isRoute =
        chainId === network.chainId &&
        calls?.length === 2 &&
        calls[0]?.to.toLowerCase() === token &&
        calls[1]?.to.toLowerCase() === swapper;
      if (isRoute) route = calls;
      // The route needs a key that can spend the MACH and call both contracts. The SDK skips a
      // route this refuses and resolves the direct transfer, which reports it.
      if (key && limit !== null && limit < payment.amount)
        throw accessKeyLimitError({
          key: key.address,
          token,
          label: "MACH",
          amount: formatTokenAmount(payment.amount),
          network,
        });
      const blocked = route?.find((call) => !storedScopesAllow(key, call));
      if (blocked)
        throw paymentError(
          `MACH settlement is unavailable: the access key's call scopes do not allow its call to the MACH ${blocked.to.toLowerCase() === token ? "token" : "swapper"} (${blocked.to.toLowerCase()}), and 'tempo wallet keys update' cannot change call scopes; the wallet owner must authorize a key that may make that call. ${noMachFallback}`,
        );
      if (isRoute) return account;
      throw await machRouteError({
        payer: account.address,
        amount: payment.amount,
        network,
        route,
        scoped: key !== undefined,
      });
    },
  };
}

type MachRouteCall = { to: Address; data: `0x${string}` };

const noMachFallback = "No stablecoin fallback was authorized.";

/**
 * Whether `key`'s stored call scopes allow `call`: a scope must name its address and, if it names
 * one, its selector. Recipient rules are not checked. Scopes stored without exact semantics are
 * unknown and allow every call.
 */
function storedScopesAllow(
  key: WalletState["accessKeys"][number] | undefined,
  call: MachRouteCall,
) {
  if (key?.permissionSemantics !== 1 || key.scopes === undefined) return true;
  const selector = call.data.slice(0, 10).toLowerCase();
  return key.scopes.some(
    (scope) =>
      scope.address.toLowerCase() === call.to.toLowerCase() &&
      (scope.selector === undefined || scope.selector.toLowerCase() === selector),
  );
}

/**
 * Why the MACH route cannot settle `amount`: the payer's MACH balance is below it, with the
 * funding command as its `cta` on mainnet, or else the route did not simulate. The SDK keeps its
 * simulation error, so the route is simulated again to tell a transient failure apart.
 */
async function machRouteError(options: {
  payer: Address;
  amount: bigint;
  network: Network;
  route: readonly MachRouteCall[] | undefined;
  /** Whether an access key pays, whose call scopes may refuse the route. */
  scoped: boolean;
}) {
  const { payer, amount, network, route } = options;
  const client = createTempoPublicClient(network.chainId);
  const balance = await readContract(client, {
    address: machToken(network.chainId),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payer],
  }).catch(() => undefined);
  if (balance === undefined)
    return networkError(
      `MACH settlement is unavailable: the MACH balance could not be read. Check RPC connectivity (TEMPO_RPC_URL). ${noMachFallback}`,
      { retryable: true },
    );
  if (balance >= amount) {
    // A route that simulates now, or failed on transport, may settle on a retry.
    const retryable =
      route !== undefined &&
      (await call(client, { account: payer, calls: route }).then(() => true, isTransientRpcError));
    const causes = options.scoped
      ? "insufficient swapper liquidity, the access key's call scopes, or a transient RPC error"
      : "insufficient swapper liquidity or a transient RPC error";
    return walletError({
      code: "E_PAYMENT",
      retryable,
      message: `MACH settlement is unavailable: the MACH swap route for ${formatTokenAmount(amount)} MACH could not be simulated. Possible causes: ${causes}.${retryable ? " Try again shortly." : ""} ${noMachFallback}`,
    });
  }
  const shortfall = `The MACH balance ${formatTokenAmount(balance)} is below the ${formatTokenAmount(amount)} MACH this charge needs.`;
  // Hosted MACH checkout is mainnet only.
  if (network.name !== "mainnet")
    return walletError({
      code: "E_INSUFFICIENT_FUNDS",
      message: `${shortfall} MACH can be bought on mainnet only. ${noMachFallback}`,
    });
  const command = continuationCommand(
    ["wallet", "fund", "--mach", "--address", payer.toLowerCase()],
    network,
  );
  return new CtaError(
    commandError(
      "E_INSUFFICIENT_FUNDS",
      `${shortfall} Buy MACH with '${command}', then retry. ${noMachFallback}`,
      command,
    ),
  );
}

/** Whether an RPC failure, or any error it wraps, is a transport failure or timeout. */
function isTransientRpcError(error: unknown) {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if (cause instanceof HttpRequestError || cause instanceof TimeoutError) return true;
  return false;
}

/** Whether a charge credential's signed transaction approves and swaps MACH, the MACH route. */
export function runsMachRoute(
  payload: Record<string, unknown>,
  deployment: { token: string; swap: string },
) {
  try {
    if (payload.type !== "transaction") return false;
    const { calls } = TempoTransaction.deserialize(
      stringValue(payload.signature) as `0x76${string}`,
    );
    return (
      calls?.length === 2 &&
      calls[0]?.to?.toLowerCase() === deployment.token.toLowerCase() &&
      calls[1]?.to?.toLowerCase() === deployment.swap.toLowerCase()
    );
  } catch {
    return false;
  }
}
