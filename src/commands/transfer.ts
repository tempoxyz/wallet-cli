import { readFile } from "node:fs/promises";

import { formatUnits, parseUnits } from "viem";
import { Credential } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { Actions } from "viem/tempo";

import { paymentOutcomeUnknownError, usageError } from "../shared/errors.js";
import { chainId, tokenDecimals, tokenSymbol } from "../shared/network.js";
import { getRecord, stringValue } from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { loadWalletState } from "../wallet/store.js";
import {
  machChargeParameters,
  parseRequestArgs,
  preparePaymentChallenge,
  resolvePaymentIdentity,
} from "./request.js";

export async function transferTokens(options: {
  args: { amount?: string | undefined; token?: string | undefined; to?: string | undefined };
  options: {
    network?: string | undefined;
    address?: string | undefined;
    "dry-run"?: boolean | undefined;
    "fee-token"?: string | undefined;
  };
}) {
  const { args } = options;
  if (!args.amount || !args.token || !args.to)
    throw new Error("amount, token, and to are required");

  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const from = options.options.address ?? activeAccount?.address;
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  if (!from)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  const chain = chainId(options.options.network);
  const token = args.token.toLowerCase() as `0x${string}`;
  const to = args.to.toLowerCase() as `0x${string}`;
  const fromAddress = from.toLowerCase();
  const outputBase = {
    chain_id: chain,
    amount: args.amount,
    symbol: tokenSymbol(args.token),
    token,
    to,
    from: fromAddress,
  };

  if (options.options["dry-run"]) {
    return {
      status: "dry_run" as const,
      ...outputBase,
    };
  }

  const provider = createProvider({ network: options.options.network });
  const call = Actions.token.transfer.call(provider.getClient() as never, {
    amount: parseUnits(args.amount, tokenDecimals()),
    token,
    to,
  });
  const receipt = await provider.request({
    method: "eth_sendTransactionSync",
    params: [
      {
        calls: [call],
        ...(options.options["fee-token"]
          ? { feeToken: options.options["fee-token"] as `0x${string}` }
          : {}),
      },
    ],
  });
  const record = getRecord(receipt);
  const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
  if (!txHash) throw new Error("Transfer submitted but receipt did not include a transaction hash");

  return {
    status: "success" as const,
    tx_hash: txHash,
    ...outputBase,
  };
}

export async function transferMach(options: {
  options: {
    network?: string | undefined;
    address?: string | undefined;
    "dry-run"?: boolean | undefined;
    "max-spend"?: string | undefined;
    "amount-cents"?: number | undefined;
    to?: string | undefined;
    data?: string | undefined;
    value?: string | undefined;
    "mpp-challenge"?: string | undefined;
    "mpp-challenge-file"?: string | undefined;
    "mpp-client-id"?: string | undefined;
  };
}) {
  const flags = options.options;
  if (flags.to !== undefined || flags.data !== undefined || flags.value !== undefined)
    throw usageError(
      "MACH does not support direct calldata transfers. Supply a machine-enabled Tempo charge with --mpp-challenge, or use 'tempo request --payment-token MACH --max-spend <amount> <url>'.",
    );
  if (flags["mpp-challenge"] && flags["mpp-challenge-file"])
    throw usageError("Use only one of --mpp-challenge and --mpp-challenge-file");
  const input =
    flags["mpp-challenge"] ??
    (flags["mpp-challenge-file"] ? await readFile(flags["mpp-challenge-file"], "utf8") : undefined);
  if (!input) throw usageError("MACH transfer requires --mpp-challenge or --mpp-challenge-file");
  const cents = flags["amount-cents"];
  if (cents !== undefined && (!Number.isSafeInteger(cents) || cents < 0))
    throw usageError("--amount-cents must be a non-negative safe integer spending cap");
  if (cents !== undefined && flags["max-spend"] !== undefined)
    throw usageError("Use only one of --max-spend and --amount-cents");
  const maxSpend =
    flags["max-spend"] ??
    (cents !== undefined ? formatUnits(BigInt(cents) * 10_000n, 6) : undefined);
  const requestOptions = parseRequestArgs([
    "--payment-token",
    "MACH",
    "--payment-intent",
    "charge",
    ...(flags.network ? ["--network", flags.network] : []),
    ...(maxSpend !== undefined ? ["--max-spend", maxSpend] : []),
    ...(flags["dry-run"] ? ["--dry-run"] : []),
    "https://mpp.invalid",
  ]);
  if (requestOptions.maxSpend === undefined && !flags["dry-run"])
    throw usageError(
      "MACH transfer requires --max-spend (or TEMPO_MAX_SPEND); --amount-cents is a legacy spending-cap alias",
    );
  const header =
    input
      .trim()
      .split(/\r?\n/)
      .find((line) => /^www-authenticate:/i.test(line))
      ?.replace(/^www-authenticate:\s*/i, "") ?? input.trim();
  const { challenge, response } = preparePaymentChallenge(
    new Response(null, { status: 402, headers: { "www-authenticate": header } }),
    requestOptions,
    requestOptions.url,
  );
  const output = {
    amount: formatUnits(BigInt(challenge.request.amount as string), 6),
    amount_raw: String(challenge.request.amount),
    token: "MACH" as const,
    settlement_currency: String(challenge.request.currency),
    chain_id: chainId(requestOptions.network),
    challenge_id: challenge.id,
    max_spend: requestOptions.maxSpend ?? null,
  };
  if (flags["dry-run"]) return { ...output, dry_run: true };
  const identity = await resolvePaymentIdentity(requestOptions);
  if (flags.address && flags.address.toLowerCase() !== identity.address.toLowerCase())
    throw usageError("--address must match the active payment wallet");
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        ...identity.methodOptions,
        getClient: identity.getClient,
        expectedChainId: chainId(requestOptions.network),
        ...machChargeParameters(requestOptions),
        clientId: flags["mpp-client-id"],
        mode: "push",
      }),
    ],
    polyfill: false,
  });
  let credential: string;
  try {
    credential = await payment.createCredential(response);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "E_PAYMENT")
      throw error;
    // The SDK may have broadcast before a transport failure. Never automatically retry.
    throw paymentOutcomeUnknownError(
      `MACH settlement did not return a confirmed result. Check challenge ${JSON.stringify(challenge.id)} with the provider before retrying.`,
    );
  }
  const { payload } = Credential.deserialize<{ type: string; hash?: string }>(credential);
  if (payload.type !== "hash" || !payload.hash || !/^0x[0-9a-fA-F]{64}$/.test(payload.hash))
    throw paymentOutcomeUnknownError(
      "MACH settlement did not return a transaction hash; check with the provider before retrying.",
    );
  return { ...output, wallet: identity.address.toLowerCase(), tx_hash: payload.hash };
}

/** Compatibility spelling. Legacy credits are never redeemed by this command. */
export const transferCredits = transferMach;
