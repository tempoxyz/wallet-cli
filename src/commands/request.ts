import { receiptSummary } from "../payment/receipt.js";
import { httpError, paymentOutcomeUnknownError, paymentError } from "../shared/errors.js";
import { parseRequestArgs, paymentTokenValue, validateRequestOptions } from "../request/args.js";
import { preparePaymentChallenge } from "../request/challenge.js";
import { payAndRetryRequest } from "../request/charge.js";
import { paymentQuote, type RequestDryRunOutput } from "../request/dry-run.js";
import {
  buildFetchRequest,
  fetchWithRetries,
  replaySafeMethods,
  responseBodyNetworkError,
} from "../request/fetch.js";
import { privateKeySigner, resolvePaymentNetwork } from "../request/identity.js";
import type { RequestOptions, RequestRunOptions } from "../request/options.js";
import {
  remoteNamePath,
  write,
  writeHeadersFile,
  writeMetaFile,
  writeOutput,
  writeResponseBody,
} from "../request/output.js";
import { paidResponseFailures, paymentReceipts, paymentReferences } from "../request/paid.js";

// `tempo wallet transfer` imports these from this path.
export { parseRequestArgs } from "../request/args.js";
export { preparePaymentChallenge } from "../request/challenge.js";
export { resolvePaymentIdentity, resolvePaymentNetwork } from "../request/identity.js";
export { machChargeParameters } from "../request/mach.js";
export { resolveMaxSpend } from "../request/spend.js";

export async function runRequest(argv: readonly string[], io: RequestRunOptions = {}) {
  const options = parseRequestArgs(argv);
  await executeRequest(options, io);
}

export async function executeRequest(options: RequestOptions, io: RequestRunOptions = {}) {
  validateRequestOptions(options);
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const started = Date.now();
  const plan = await buildFetchRequest(options);
  const method = plan.init.method ?? "GET";
  let { request, response } = await fetchWithRetries(plan, options);

  let paid = false;

  if (options.dryRun && response.status !== 402) {
    await response.body?.cancel().catch(() => undefined);
    const probeMethod = method.toUpperCase();
    if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
    if (options.writeMeta) await writeMetaFile(options.writeMeta, response, started);
    const probe: RequestDryRunOutput = {
      payment_required: false,
      status: response.status,
      probe_sent: true,
      ...(replaySafeMethods.has(probeMethod)
        ? {}
        : {
            warning: `The ${probeMethod} request was sent to the server and may have had side effects`,
          }),
    };
    await writeOutput(options.output, `${JSON.stringify(probe, null, 2)}\n`, stdout);
    return;
  }

  if (response.status === 402) {
    // Only payment depends on the network, so free requests never read the wallet store.
    options.network = (await resolvePaymentNetwork(options)).name;
    options.paymentToken = paymentTokenValue(options);
    if (options.dryRun) {
      const { challenge } = preparePaymentChallenge(response, options, request.url);
      const quote = await paymentQuote(challenge, options, request.url);
      if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
      if (options.writeMeta) await writeMetaFile(options.writeMeta, response, started);
      await writeOutput(options.output, `${JSON.stringify(quote, null, 2)}\n`, stdout);
      return;
    }

    if (options.insecure && !options.allowInsecurePayment)
      throw paymentError(
        "Refusing to pay over a connection with TLS certificate verification disabled (--insecure); pass --allow-insecure-payment to override",
      );
    response = await payAndRetryRequest(response, request, options, stderr);
    paid = true;
  }

  // Only a 2xx response confirms the paid request: an HTTP error, an unfollowed redirect, or a
  // failed receipt update leaves the payment's outcome unknown, so it reports no receipt.
  const receipt =
    response.ok && !paidResponseFailures.has(response) ? paymentReceipts.get(response) : undefined;
  try {
    if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
    if (options.writeMeta)
      await writeMetaFile(
        options.writeMeta,
        response,
        started,
        paid ? privateKeySigner(options) : undefined,
        receipt,
      );
    if (response.status >= 400 && options.sseJson) {
      const body = await response.text().catch(responseBodyNetworkError(method));
      await writeOutput(
        options.output ?? (options.remoteName ? remoteNamePath(options.url) : undefined),
        `${JSON.stringify({ event: "error", status: response.status, message: `HTTP ${response.status}${body ? `: ${body}` : ""}`, ts: new Date().toISOString() })}\n`,
        stdout,
      );
    } else {
      await writeResponseBody(response, options, stdout, method);
    }
    if (paidResponseFailures.has(response))
      throw paymentOutcomeUnknownError(
        `Paid response processing failed; payment may have completed.${paymentReferences.get(response) ?? ""} Check any saved response metadata and contact the provider before retrying.`,
      );
    if (response.status >= 400) throw httpError(response.status);
  } catch (error) {
    // The body never fully arrived, so the receipt stays for recovery but is marked unconfirmed.
    if (receipt && options.writeMeta)
      await writeMetaFile(options.writeMeta, response, started, privateKeySigner(options), {
        ...receipt,
        outcome: "unknown",
      }).catch(() => undefined);
    if (
      paid &&
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "E_HTTP" || error.code === "E_PAYMENT_OUTCOME_UNKNOWN")
      )
    )
      throw paymentOutcomeUnknownError(
        `Paid response delivery failed; payment may have completed.${paymentReferences.get(response) ?? ""} Check any saved response metadata and contact the provider before retrying.`,
      );
    throw error;
  }
  if (receipt) {
    try {
      await write(stderr, receiptSummary(receipt));
    } catch {
      // The payment and its response already succeeded; the summary is best-effort.
    }
  }
}
