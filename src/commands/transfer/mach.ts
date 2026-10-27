import { readFile } from "node:fs/promises";

import { formatUnits } from "viem";
import { Errors } from "incur";
import { Challenge, Credential } from "mppx";
import { Mppx, tempo } from "mppx/client";

import type { RetiredFlag } from "../../cli/argv.js";
import { CtaError } from "../../cli/incur-compat.js";
import { commandError, paymentOutcomeUnknownError, usageError } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { nextStep, shellQuote } from "../../shared/next.js";
import { escapeInvisible } from "../../shared/utils.js";
import { parseRequestArgs } from "../../request/args.js";
import { preparePaymentChallenge } from "../../request/challenge.js";
import { resolvePaymentIdentity, resolvePaymentNetwork } from "../../request/identity.js";
import { machChargeParameters } from "../../request/mach.js";

/** The realm of the captured challenge, or "The service" when it names none. */
function challengeRealm(header: string) {
  try {
    const realm = Challenge.deserializeList(header)[0]?.realm;
    if (realm) return realm;
  } catch {
    // preparePaymentChallenge reports a malformed challenge.
  }
  return "The service";
}

export async function transferMach(options: {
  options: {
    network?: string | undefined;
    address?: string | undefined;
    "dry-run"?: boolean | undefined;
    "max-spend"?: string | undefined;
    to?: string | undefined;
    data?: string | undefined;
    "mpp-challenge"?: string | undefined;
    "mpp-challenge-file"?: string | undefined;
    "mpp-client-id"?: string | undefined;
  };
}) {
  const flags = options.options;
  if (flags.to !== undefined || flags.data !== undefined)
    throw usageError(
      "MACH does not support direct calldata transfers. Supply a machine-enabled Tempo charge with --mpp-challenge, or use 'tempo request --payment-token MACH --max-spend <amount> <url>'.",
    );
  if (flags["mpp-challenge"] && flags["mpp-challenge-file"])
    throw usageError("Use only one of --mpp-challenge and --mpp-challenge-file");
  const input =
    flags["mpp-challenge"] ??
    (flags["mpp-challenge-file"] ? await readFile(flags["mpp-challenge-file"], "utf8") : undefined);
  if (!input) throw usageError("MACH transfer requires --mpp-challenge or --mpp-challenge-file");
  const maxSpend = flags["max-spend"];
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
  // TEMPO_PRIVATE_KEY can pay here too, so resolve the network the way request payments do.
  const network = await resolvePaymentNetwork(requestOptions);
  requestOptions.network = network.name;
  if (requestOptions.maxSpend === undefined && !flags["dry-run"])
    throw usageError("MACH transfer requires --max-spend (or TEMPO_MAX_SPEND)");
  const header =
    input
      .trim()
      .split(/\r?\n/)
      .find((line) => /^www-authenticate:/i.test(line))
      ?.replace(/^www-authenticate:\s*/i, "") ?? input.trim();
  // A captured challenge has no URL; its realm names the service.
  const host = challengeRealm(header);
  const { challenge, response } = preparePaymentChallenge(
    new Response(null, { status: 402, headers: { "www-authenticate": header } }),
    requestOptions,
    requestOptions.url,
    host,
  );
  const output = {
    amount: formatUnits(BigInt(challenge.request.amount as string), 6),
    raw_amount: String(challenge.request.amount),
    token: "MACH" as const,
    settlement_currency: String(challenge.request.currency),
    ...networkFields(network.chainId),
    challenge_id: challenge.id,
    max_spend: requestOptions.maxSpend ?? null,
  };
  if (flags["dry-run"])
    return {
      status: "dry_run" as const,
      ...output,
      ...(output.max_spend !== null
        ? nextStep(
            `Run the next command to pay ${output.amount} MACH for this challenge.`,
            [
              "wallet",
              "transfer",
              "--mach",
              "--max-spend",
              output.max_spend,
              "--mpp-challenge",
              header,
              ...(flags["mpp-client-id"] ? ["--mpp-client-id", flags["mpp-client-id"]] : []),
              ...(flags.address ? ["--address", flags.address] : []),
            ],
            { network },
          )
        : {}),
    };
  const identity = await resolvePaymentIdentity(requestOptions);
  if (flags.address && flags.address.toLowerCase() !== identity.address.toLowerCase())
    throw usageError("--address must match the active payment wallet");
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        ...identity.methodOptions,
        getClient: identity.getClient,
        expectedChainId: network.chainId,
        ...machChargeParameters(requestOptions, {
          amount: BigInt(output.raw_amount),
          key: "key" in identity ? identity.key : undefined,
          recipient: String(challenge.request.recipient),
          host,
        }),
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
    // The route refuses a charge it cannot settle before anything is signed.
    if (error instanceof Errors.IncurError) throw error;
    // The SDK may have broadcast before a transport failure. Never automatically retry.
    throw paymentOutcomeUnknownError(
      `MACH settlement did not return a confirmed result. Check challenge ${escapeInvisible(JSON.stringify(challenge.id))} with the provider before retrying.`,
    );
  }
  const { payload } = Credential.deserialize<{ type: string; hash?: string }>(credential);
  if (payload.type !== "hash" || !payload.hash || !/^0x[0-9a-fA-F]{64}$/.test(payload.hash))
    throw paymentOutcomeUnknownError(
      "MACH settlement did not return a transaction hash; check with the provider before retrying.",
    );
  return {
    status: "success" as const,
    ...output,
    wallet: identity.address.toLowerCase(),
    tx_hash: payload.hash,
  };
}

const amountCentsMessage =
  "--amount-cents was removed from --mach; pass the spending cap in USD with --max-spend.";

/**
 * `--amount-cents` capped MACH spending in USD cents before `--max-spend`. The CLI refuses it
 * before parsing, so any value is refused; the `cta` passes a whole number of cents in USD. With
 * `--max-spend` too, the caps conflict, so there is no `cta` to pick one.
 */
export const machAmountCentsFlag: RetiredFlag = {
  flag: "--amount-cents",
  takesValue: true,
  when: ["--mach"],
  replacement: ({ args, value }) => ({
    message: amountCentsMessage,
    argv:
      value === undefined ||
      !/^\d+$/.test(value) ||
      args.some((arg) => arg === "--max-spend" || arg.startsWith("--max-spend="))
        ? undefined
        : ["transfer", ...args, "--max-spend", formatUnits(BigInt(value) * 10_000n, 6)],
  }),
};

/**
 * `--amount-cents` with `mach` over MCP, which parses options before the command runs. The `cta`
 * passes the same cap in USD, keeping the other options; with `max-spend` too, there is none.
 */
export function machAmountCentsError(
  flags: Parameters<typeof transferMach>[0]["options"],
  cents: number,
) {
  const message = amountCentsMessage;
  if (!Number.isSafeInteger(cents) || cents < 0 || flags["max-spend"] !== undefined)
    return usageError(message);
  const argv = [
    "tempo",
    "wallet",
    "transfer",
    "--mach",
    "--max-spend",
    formatUnits(BigInt(cents) * 10_000n, 6),
    ...(flags["mpp-challenge"] !== undefined ? ["--mpp-challenge", flags["mpp-challenge"]] : []),
    ...(flags["mpp-challenge-file"] !== undefined
      ? ["--mpp-challenge-file", flags["mpp-challenge-file"]]
      : []),
    ...(flags["mpp-client-id"] !== undefined ? ["--mpp-client-id", flags["mpp-client-id"]] : []),
    ...(flags.address !== undefined ? ["--address", flags.address] : []),
    ...(flags["dry-run"] ? ["--dry-run"] : []),
    ...(flags.network !== undefined ? ["--network", flags.network] : []),
  ];
  return new CtaError(commandError("E_USAGE", message, argv.map(shellQuote).join(" ")));
}
