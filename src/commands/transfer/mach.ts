import { readFile } from "node:fs/promises";

import { formatUnits } from "viem";
import { Errors } from "incur";
import { Credential } from "mppx";
import { Mppx, tempo } from "mppx/client";

import { paymentOutcomeUnknownError, usageError } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { nextStep } from "../../shared/next.js";
import { escapeInvisible } from "../../shared/utils.js";
import { parseRequestArgs } from "../../request/args.js";
import { preparePaymentChallenge } from "../../request/challenge.js";
import { resolvePaymentIdentity, resolvePaymentNetwork } from "../../request/identity.js";
import { machChargeParameters } from "../../request/mach.js";

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
  // TEMPO_PRIVATE_KEY can pay here too, so resolve the network the way request payments do.
  const network = await resolvePaymentNetwork(requestOptions);
  requestOptions.network = network.name;
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
    ...networkFields(network.chainId),
    challenge_id: challenge.id,
    max_spend: requestOptions.maxSpend ?? null,
  };
  if (flags["dry-run"])
    return {
      ...output,
      dry_run: true,
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
          amount: BigInt(output.amount_raw),
          key: "key" in identity ? identity.key : undefined,
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
  return { ...output, wallet: identity.address.toLowerCase(), tx_hash: payload.hash };
}
