import { createWriteStream } from "node:fs";
import { File } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { Challenge, Credential, PaymentRequest } from "mppx";
import { Mppx, session as tempoSession, tempo } from "mppx/client";
import { Session as TempoSession } from "mppx/tempo";
import {
  Agent,
  EnvHttpProxyAgent,
  type Dispatcher,
  fetch as undiciFetch,
  FormData as UndiciFormData,
  ProxyAgent,
} from "undici";
import { createWalletClient, encodeFunctionData, http, parseUnits } from "viem";
import { prepareTransactionRequest, signTransaction } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";
import {
  Abis as TempoAbis,
  Account as TempoAccount,
  Actions,
  Chain,
  Channel as TempoChannel,
  KeyAuthorizationManager,
} from "viem/tempo";

import { withSessionLock } from "../payment/session-lock.js";
import { requireSessionDescriptor } from "../payment/session-descriptor.js";
import {
  deleteSessionRecord,
  findReusableSession,
  originFromUrl,
  type PersistedSessionRecord,
  preserveSessionCumulative,
  updateSessionReceipt,
  upsertSessionRecord,
} from "../payment/session-store.js";
import { connect, createProvider } from "../provider.js";
import { escrowAbi, version } from "../shared/constants.js";
import { networkError, paymentError, usageError } from "../shared/errors.js";
import {
  chainId,
  createTempoPublicClient,
  escrowContract,
  networkName,
  rpcUrl,
} from "../shared/network.js";
import { getRecord, nowSeconds, parseOnChainBigInt, stringValue } from "../shared/utils.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";

export type RequestOptions = {
  bearer?: string | undefined;
  compressed?: boolean | undefined;
  data: string[];
  dataUrlencode: string[];
  dumpHeader?: string | undefined;
  dryRun?: boolean | undefined;
  followRedirects?: boolean | undefined;
  form: string[];
  get?: boolean | undefined;
  head?: boolean | undefined;
  headers: string[];
  includeHeaders?: boolean | undefined;
  insecure?: boolean | undefined;
  json?: string | undefined;
  connectTimeout?: number | undefined;
  maxRedirs?: number | undefined;
  maxTime?: number | undefined;
  method?: string | undefined;
  maxSpend?: string | undefined;
  network?: string | undefined;
  noProxy?: boolean | undefined;
  output?: string | undefined;
  privateKey?: string | undefined;
  proxy?: string | undefined;
  referer?: string | undefined;
  remoteName?: boolean | undefined;
  requestHttp1?: boolean | undefined;
  requestHttp2?: boolean | undefined;
  retries?: number | undefined;
  retryAfter?: boolean | undefined;
  retryBackoffMs?: number | undefined;
  retryHttp?: string | undefined;
  retryJitter?: number | undefined;
  sse?: boolean | undefined;
  sseJson?: boolean | undefined;
  stream?: boolean | undefined;
  toon?: string | undefined;
  url: string;
  user?: string | undefined;
  userAgent?: string | undefined;
  writeMeta?: string | undefined;
};

export type RequestRunOptions = {
  stdout?: Pick<NodeJS.WriteStream, "write"> | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
};

type FetchPlan = {
  init: RequestInitWithDispatcher;
  url: string;
};

type RequestInitWithDispatcher = RequestInit & {
  dispatcher?: Dispatcher | undefined;
};

const defaultRetryStatuses = new Set([408, 429, 500, 502, 503, 504]);

export async function runRequest(argv: readonly string[], io: RequestRunOptions = {}) {
  const options = parseRequestArgs(argv);
  await executeRequest(options, io);
}

export function parseRequestArgs(argv: readonly string[]): RequestOptions {
  const options: Omit<RequestOptions, "url"> = {
    data: [],
    dataUrlencode: [],
    form: [],
    headers: [],
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-s":
      case "--silent":
      case "-v":
      case "--verbose":
      case "-t":
      case "--toon-output":
        break;
      case "--max-spend":
        options.maxSpend = requireValue(argv, ++index, arg);
        break;
      case "--private-key":
        options.privateKey = requireValue(argv, ++index, arg);
        break;
      case "-n":
      case "--network":
        options.network = normalizeNetwork(requireValue(argv, ++index, arg));
        break;
      case "--offline":
        throw networkError("--offline mode enabled; refusing to make network requests");
      case "-i":
      case "--include":
        options.includeHeaders = true;
        break;
      case "-I":
        options.head = true;
        options.includeHeaders = true;
        break;
      case "-L":
      case "--location":
        options.followRedirects = true;
        break;
      case "-G":
      case "--get":
        options.get = true;
        break;
      case "-k":
      case "--insecure":
        options.insecure = true;
        break;
      case "--stream":
        options.stream = true;
        break;
      case "--sse":
        options.sse = true;
        break;
      case "--sse-json":
        options.sseJson = true;
        break;
      case "--compressed":
        options.compressed = true;
        break;
      case "-O":
      case "--remote-name":
        options.remoteName = true;
        break;
      case "--no-proxy":
        options.noProxy = true;
        break;
      case "--http2":
        options.requestHttp2 = true;
        break;
      case "--http1.1":
      case "--http1_1":
        options.requestHttp1 = true;
        break;
      case "-X":
      case "--request":
        options.method = requireValue(argv, ++index, arg);
        break;
      case "-H":
      case "--header":
        options.headers.push(requireValue(argv, ++index, arg));
        break;
      case "-o":
      case "--output":
        options.output = requireValue(argv, ++index, arg);
        break;
      case "-m":
      case "--timeout":
        options.maxTime = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--connect-timeout":
        options.connectTimeout = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "-d":
      case "--data":
        options.data.push(requireValue(argv, ++index, arg));
        break;
      case "--json":
        if (options.toon !== undefined) throw usageError("--json cannot be used with --toon");
        options.json = requireValue(argv, ++index, arg);
        break;
      case "--toon":
        if (options.json !== undefined) throw usageError("--toon cannot be used with --json");
        options.toon = requireValue(argv, ++index, arg);
        break;
      case "--retries":
        options.retries = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-backoff":
        options.retryBackoffMs = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-jitter":
        options.retryJitter = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--max-redirs":
        options.maxRedirs = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-http":
        options.retryHttp = requireValue(argv, ++index, arg);
        break;
      case "--retry-after":
        options.retryAfter = true;
        break;
      case "-A":
      case "--user-agent":
        options.userAgent = requireValue(argv, ++index, arg);
        break;
      case "-D":
      case "--dump-header":
        options.dumpHeader = requireValue(argv, ++index, arg);
        break;
      case "-u":
      case "--user":
        options.user = requireValue(argv, ++index, arg);
        break;
      case "--bearer":
        options.bearer = requireValue(argv, ++index, arg);
        break;
      case "--write-meta":
        options.writeMeta = requireValue(argv, ++index, arg);
        break;
      case "--proxy":
        options.proxy = requireValue(argv, ++index, arg);
        break;
      case "-e":
      case "--referer":
        options.referer = requireValue(argv, ++index, arg);
        break;
      case "--data-urlencode":
        options.dataUrlencode.push(requireValue(argv, ++index, arg));
        break;
      case "-F":
      case "--form":
        options.form.push(requireValue(argv, ++index, arg));
        break;
      default:
        throw usageError(`Unsupported request option: ${arg}`);
    }
  }

  if (options.requestHttp1 && options.requestHttp2)
    throw usageError("--http2 cannot be used with --http1.1");
  if (
    options.form.length > 0 &&
    (options.data.length > 0 ||
      options.dataUrlencode.length > 0 ||
      options.json !== undefined ||
      options.toon !== undefined ||
      options.get)
  )
    throw usageError(
      "--form cannot be used with --data, --data-urlencode, --json, --toon, or --get",
    );
  if (positionals.length !== 1) throw usageError("URL is required");

  const url = positionals[0];
  if (!url) throw usageError("URL is required");
  validateUrl(url);

  return { ...options, url };
}

export async function executeRequest(options: RequestOptions, io: RequestRunOptions = {}) {
  const stdout = io.stdout ?? process.stdout;
  const started = Date.now();
  const request = await buildFetchRequest(options);
  let response = await fetchWithRetries(request, options);

  if (options.dumpHeader) await writeHeadersFile(options.dumpHeader, response);
  if (options.writeMeta) await writeMetaFile(options.writeMeta, response, started);

  if (response.status === 402) {
    if (options.dryRun) {
      await writeResponseBody(response, options, stdout);
      return;
    }

    response = await payAndRetryRequest(response, request, options);
  }

  if (response.status >= 400) {
    const body = await response.text().catch(() => "");
    if (options.sseJson) {
      write(
        stdout,
        `${JSON.stringify({ event: "error", message: `HTTP ${response.status}${body ? `: ${body}` : ""}`, ts: new Date().toISOString() })}\n`,
      );
    }
    throw networkError(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  await writeResponseBody(response, options, stdout);
}

async function buildFetchRequest(options: RequestOptions) {
  validateUrl(options.url);
  const url = new URL(options.url);
  const headers = new Headers();
  let body: BodyInit | undefined;
  let method = options.method ?? (options.head ? "HEAD" : undefined);

  headers.set("user-agent", `tempo/${version}`);
  if (options.userAgent) headers.set("user-agent", options.userAgent);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.user)
    headers.set("authorization", `Basic ${Buffer.from(options.user).toString("base64")}`);
  if (options.referer) headers.set("referer", options.referer);
  if (options.compressed) headers.set("accept-encoding", "gzip, deflate, br");

  for (const header of options.headers) {
    const separator = header.indexOf(":");
    if (separator <= 0) throw usageError(`Invalid header: ${header}`);
    headers.set(header.slice(0, separator).trim(), header.slice(separator + 1).trim());
  }

  if (options.json !== undefined) {
    JSON.parse(options.json);
    body = options.json;
    headers.set("content-type", headers.get("content-type") ?? "application/json");
    method ??= "POST";
  } else if (options.toon !== undefined) {
    // Minimal TOON input compatibility for common "key: value" agent prompts.
    body = JSON.stringify(parseSimpleToon(options.toon));
    headers.set("content-type", headers.get("content-type") ?? "application/json");
    method ??= "POST";
  } else if (options.form.length > 0) {
    const form = new UndiciFormData();
    for (const field of options.form) await appendFormField(form, field);
    body = form as unknown as BodyInit;
    method ??= "POST";
  } else if (options.data.length > 0 || options.dataUrlencode.length > 0) {
    const data = [
      ...(await Promise.all(options.data.map(readDataValue))),
      ...options.dataUrlencode.map(urlEncodeField),
    ].join("&");
    if (options.get) appendQuery(url, data);
    else {
      body = data;
      headers.set(
        "content-type",
        headers.get("content-type") ?? "application/x-www-form-urlencoded",
      );
      method ??= "POST";
    }
  }

  method ??= "GET";
  validateMethod(method);

  const init: RequestInitWithDispatcher = {
    headers,
    method,
    redirect: "manual",
  };
  if (body !== undefined) init.body = body;
  if (options.maxTime) init.signal = AbortSignal.timeout(options.maxTime * 1000);
  init.dispatcher = buildDispatcher(options);

  return { init, url: url.toString() };
}

async function fetchWithRetries(
  request: FetchPlan,
  options: RequestOptions,
  fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
) {
  const retryStatuses = parseRetryStatuses(options.retryHttp, options.retries);
  const attempts = (options.retries ?? 0) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchWithRedirects(request, options, fetchImpl);
      if (attempt + 1 < attempts && retryStatuses.has(response.status)) {
        await waitBeforeRetry(response, options, attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await waitBeforeRetry(undefined, options, attempt);
    }
  }

  throw networkError(lastError instanceof Error ? lastError.message : String(lastError));
}

async function fetchWithRedirects(
  request: FetchPlan,
  options: RequestOptions,
  fetchImpl: typeof fetch,
) {
  let current = { init: cloneRequestInit(request.init), url: request.url };
  const limit = options.followRedirects ? (options.maxRedirs ?? 10) : 0;

  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(current.url, cloneRequestInit(current.init));
    if (!options.followRedirects || !isRedirectStatus(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects >= limit) throw networkError(`Too many redirects: exceeded ${limit}`);

    current = redirectRequest(current, response.status, location);
  }
}

function redirectRequest(request: FetchPlan, status: number, location: string): FetchPlan {
  const nextUrl = new URL(location, request.url).toString();
  const init = cloneRequestInit(request.init);
  const method = init.method?.toUpperCase() ?? "GET";

  if (
    (status === 301 || status === 302 || status === 303) &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    init.method = "GET";
    delete init.body;
    const headers = new Headers(init.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    init.headers = headers;
  }

  return { init, url: nextUrl };
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function payAndRetryRequest(
  paymentRequiredResponse: Response,
  request: FetchPlan,
  options: RequestOptions,
) {
  const header = paymentRequiredResponse.headers.get("www-authenticate");
  const preflightError = paymentChallengeError(header);
  if (preflightError) throw preflightError;

  const sessionChallenge = sessionChallengeFromHeader(header);
  if (sessionChallenge)
    return withSessionLock(request.url, () =>
      paySessionAndRetryRequest(paymentRequiredResponse, request, options, sessionChallenge),
    );

  try {
    const identity = await resolvePaymentIdentity(options);
    const provider = "provider" in identity ? identity.provider : undefined;
    const providerState = "providerState" in identity ? identity.providerState : undefined;
    const getClient = identity.getClient;
    const methodOptions = {
      ...identity.methodOptions,
      getClient,
      ...(options.maxSpend ? { maxDeposit: options.maxSpend } : {}),
    };
    const payment = Mppx.create({
      methods: [tempo(methodOptions), tempo.subscription({ getClient })],
      polyfill: false,
    });

    payment.onChallengeReceived(async ({ challenge, createCredential }) => {
      enforceMaxSpend(challenge, options);
      if (provider && providerState!.store.getState().accounts.length === 0)
        await connect(provider);
      return await createCredential(paymentContext(challenge, options) as never);
    });

    const credential = await payment.createCredential(paymentRequiredResponse);
    const paidInit = payment.transport.setCredential(cloneRequestInit(request.init), credential);
    return await fetchWithRetries(
      { init: paidInit, url: paymentRequiredResponse.url || request.url },
      options,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).code === "E_PAYMENT"
    )
      throw error;
    throw paymentError(error instanceof Error ? error.message : String(error));
  }
}

async function paySessionAndRetryRequest(
  paymentRequiredResponse: Response,
  request: FetchPlan,
  options: RequestOptions,
  challenge: Challenge.Challenge,
  skipChannelId?: string | undefined,
) {
  try {
    const identity = await resolvePaymentIdentity(options);
    const details = sessionDetails(challenge, request.url, options);
    const reusable = await reusableSessionRecord(details, identity, skipChannelId);
    const payment = Mppx.create({
      methods: [
        tempoSession({
          ...identity.methodOptions,
          ...(options.maxSpend ? { maxDeposit: options.maxSpend } : {}),
        }),
      ],
      polyfill: false,
    });

    let signedCumulative: bigint;
    let credential: string;
    let record: PersistedSessionRecord | undefined;

    if (reusable) {
      signedCumulative =
        maxBigInt(reusable.cumulative_amount, reusable.accepted_cumulative, reusable.server_spent) +
        details.amount;
      enforceSessionMaxSpend(signedCumulative, options);
      await preserveSessionCumulative(reusable.channel_id, signedCumulative);
      credential = await payment.createCredential(paymentRequiredResponse, {
        action: "voucher",
        channelId: reusable.channel_id as `0x${string}`,
        cumulativeAmountRaw: signedCumulative.toString(),
        ...(reusable.descriptor_json ? { descriptor: requireSessionDescriptor(reusable) } : {}),
      });
      record = reusable;
    } else {
      const depositRaw = sessionDepositRaw(details, options);
      await assertSufficientSessionBalance(identity.address, details, depositRaw);
      signedCumulative = details.amount;
      enforceSessionMaxSpend(signedCumulative, options);
      credential = await payment.createCredential(paymentRequiredResponse, {
        depositRaw: depositRaw.toString(),
      });
      record = sessionRecordFromOpenCredential({
        challenge,
        credential,
        depositRaw,
        details,
        identity,
        signedCumulative,
      });
      await upsertSessionRecord(record);
    }

    const paidInit = payment.transport.setCredential(cloneRequestInit(request.init), credential);
    const response = await fetchWithRetries(
      { init: paidInit, url: paymentRequiredResponse.url || request.url },
      options,
    );
    if (reusable && response.status === 402) {
      const recovered = await tryTopUpAndRetry({
        credential,
        details,
        identity,
        options,
        payment,
        paymentRequiredResponse,
        record: reusable,
        request,
        response,
        signedCumulative,
      });
      if (recovered) return recovered;
    }
    if (reusable && (await isSessionInvalidationResponse(response))) {
      await deleteSessionRecord(reusable.channel_id);
      return paySessionAndRetryRequest(
        paymentRequiredResponse,
        request,
        options,
        challenge,
        reusable.channel_id,
      );
    }
    await persistSessionReceipt(response, record.channel_id, signedCumulative);
    return response;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).code === "E_PAYMENT"
    )
      throw error;
    throw paymentError(error instanceof Error ? error.message : String(error));
  }
}

async function resolvePaymentIdentity(options: RequestOptions) {
  const privateKey = options.privateKey ?? process.env.TEMPO_PRIVATE_KEY;
  if (privateKey) {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const getClient = ({ chainId }: { chainId?: number | undefined }) =>
      createWalletClient({
        account,
        chain: chainId === 42431 ? Chain.tempoModerato : Chain.tempo,
        transport: http(rpcUrl(chainId === 42431 ? "testnet" : "mainnet")),
      });
    return {
      address: account.address,
      getClient,
      methodOptions: { account, mode: "pull" as const },
      signerAddress: account.address,
    };
  }

  const walletState = await loadWalletState();
  const stored = await storedAccessKeyIdentity(walletState, options);
  if (stored) return stored;

  const provider = createProvider({ network: options.network });
  const providerState = provider as unknown as {
    store: { getState(): { accounts: { address: string }[]; activeAccount: number } };
  };
  if (providerState.store.getState().accounts.length === 0) await connect(provider);
  const getClient = ({ chainId }: { chainId?: number | undefined }) => {
    const client = provider.getClient({ chainId });
    const state = providerState.store.getState();
    const account = state.accounts[state.activeAccount];
    if (!account) throw new Error("No active account.");
    return Object.assign(client, {
      account: {
        address: account.address,
        type: "json-rpc" as const,
      },
    });
  };
  const state = providerState.store.getState();
  const account = state.accounts[state.activeAccount];
  if (!account) throw new Error("No active account.");
  return {
    address: account.address,
    getClient,
    provider,
    providerState,
    signerAddress: account.address,
    methodOptions: {
      getClient,
      ...(options.maxSpend ? { maxDeposit: options.maxSpend } : {}),
    },
  };
}

export async function storedAccessKeyIdentity(walletState: WalletState, options: RequestOptions) {
  const activeAccount = walletState.accounts[walletState.activeAccount ?? 0];
  if (!activeAccount) return undefined;

  const expectedChain = chainId(options.network);
  for (const key of walletState.accessKeys) {
    if (key.chainId !== expectedChain || !key.privateKey) continue;
    if (key.keyType && key.keyType !== "secp256k1" && key.keyType !== "p256") continue;

    const keyAuthorizationManager = KeyAuthorizationManager.memory();
    if (key.keyAuthorization) {
      await keyAuthorizationManager.set(
        {
          address: activeAccount.address as `0x${string}`,
          accessKey: key.address as `0x${string}`,
          chainId: expectedChain,
        },
        key.keyAuthorization as never,
      );
    }

    const account =
      key.keyType === "p256"
        ? TempoAccount.fromP256(key.privateKey as `0x${string}`, {
            access: activeAccount.address as `0x${string}`,
            keyAuthorizationManager,
          })
        : TempoAccount.fromSecp256k1(key.privateKey as `0x${string}`, {
            access: activeAccount.address as `0x${string}`,
            keyAuthorizationManager,
          });
    if (key.address.toLowerCase() !== account.accessKeyAddress.toLowerCase()) continue;

    const getClient = ({ chainId }: { chainId?: number | undefined }) =>
      createWalletClient({
        account,
        chain: chainId === 42431 ? Chain.tempoModerato : Chain.tempo,
        transport: http(rpcUrl(chainId === 42431 ? "testnet" : "mainnet")),
      });
    return {
      account,
      address: account.address,
      getClient,
      methodOptions: { account, getClient, mode: "pull" as const },
      signerAddress: account.accessKeyAddress,
    };
  }

  return undefined;
}

type PaymentIdentity = Awaited<ReturnType<typeof resolvePaymentIdentity>>;

function sessionDetails(
  challenge: Challenge.Challenge,
  requestUrl: string,
  options: RequestOptions,
) {
  const request = challenge.request as Record<string, unknown>;
  const methodDetails = getRecord(request.methodDetails);
  const resolvedChainId =
    typeof methodDetails.chainId === "number" ? methodDetails.chainId : chainId(options.network);
  const amount = bigintField(request.amount, "amount");
  const token = stringValue(request.currency).toLowerCase();
  const payee = stringValue(request.recipient).toLowerCase();
  if (!token) throw paymentError("Session challenge is missing currency");
  if (!payee) throw paymentError("Session challenge is missing recipient");

  return {
    amount,
    chainId: resolvedChainId,
    escrowContract: stringValue(
      methodDetails.escrowContract || escrowContract(resolvedChainId),
    ).toLowerCase(),
    feePayer: Boolean(methodDetails.feePayer),
    origin: originFromUrl(requestUrl),
    payee,
    requestUrl,
    suggestedDeposit:
      typeof request.suggestedDeposit === "string" && /^\d+$/.test(request.suggestedDeposit)
        ? BigInt(request.suggestedDeposit)
        : undefined,
    token,
  };
}

type SessionDetails = ReturnType<typeof sessionDetails>;

async function reusableSessionRecord(
  details: SessionDetails,
  identity: PaymentIdentity,
  skipChannelId?: string | undefined,
): Promise<PersistedSessionRecord | undefined> {
  const record = await findReusableSession({
    authorizedSigner: identity.signerAddress,
    chainId: details.chainId,
    escrowContract: details.escrowContract,
    origin: details.origin,
    payee: details.payee,
    payer: identity.address,
    token: details.token,
  });
  if (!record) return undefined;
  if (skipChannelId && record.channel_id.toLowerCase() === skipChannelId.toLowerCase())
    return undefined;
  if (
    record.escrow_contract.toLowerCase() === TempoChannel.address.toLowerCase() &&
    !record.descriptor_json
  ) {
    await deleteSessionRecord(record.channel_id);
    return await reusableSessionRecord(details, identity, skipChannelId);
  }

  const onChain = await readOnChainChannel(record);
  if (!onChain) {
    await deleteSessionRecord(record.channel_id);
    return undefined;
  }
  if (onChain.closeRequestedAt !== 0n || onChain.deposit <= onChain.settled) {
    await deleteSessionRecord(record.channel_id);
    return undefined;
  }
  if (
    onChain.payer.toLowerCase() !== identity.address.toLowerCase() ||
    onChain.payee.toLowerCase() !== details.payee ||
    onChain.token.toLowerCase() !== details.token ||
    onChain.authorizedSigner.toLowerCase() !== identity.signerAddress.toLowerCase()
  ) {
    await deleteSessionRecord(record.channel_id);
    return undefined;
  }
  return record;
}

export async function isSessionInvalidationResponse(response: Response) {
  if (response.status !== 404 && response.status !== 410) return false;

  const authenticate = response.headers.get("www-authenticate")?.toLowerCase() ?? "";
  if (authenticate.includes("mpp") || authenticate.includes("payment")) return true;

  const body = await response
    .clone()
    .text()
    .catch(() => "");
  const text = body.toLowerCase();
  return (
    (text.includes("session") || text.includes("channel")) &&
    (text.includes("not found") ||
      text.includes("invalid") ||
      text.includes("expired") ||
      text.includes("closed"))
  );
}

async function tryTopUpAndRetry(options: {
  credential: string;
  details: SessionDetails;
  identity: PaymentIdentity;
  options: RequestOptions;
  payment: ReturnType<typeof Mppx.create>;
  paymentRequiredResponse: Response;
  record: PersistedSessionRecord;
  request: FetchPlan;
  response: Response;
  signedCumulative: bigint;
}) {
  const body = await options.response.text().catch(() => "");
  const additionalDeposit = topUpAmountFromProblem(body, options.record, options.signedCumulative);
  if (additionalDeposit <= 0n) return undefined;
  if (options.options.maxSpend) {
    const maxSpend = parseUnits(options.options.maxSpend, 6);
    if (options.record.deposit + additionalDeposit > maxSpend) return undefined;
  }

  const transaction = await buildTopUpTransaction({
    additionalDeposit,
    details: options.details,
    identity: options.identity,
    record: options.record,
  });
  const topUpCredential = await options.payment.createCredential(options.paymentRequiredResponse, {
    action: "topUp",
    additionalDepositRaw: additionalDeposit.toString(),
    channelId: options.record.channel_id,
    ...(options.record.descriptor_json
      ? { descriptor: requireSessionDescriptor(options.record) }
      : {}),
    transaction,
  } as never);
  const topUpInit = topUpRequestInit(options.request.init);
  const authorizedTopUp = options.payment.transport.setCredential(topUpInit, topUpCredential);
  const topUpResponse = await fetchWithRetries(
    { init: authorizedTopUp, url: options.paymentRequiredResponse.url || options.request.url },
    options.options,
  );
  if (topUpResponse.status >= 400) return topUpResponse;

  await upsertSessionRecord({
    ...options.record,
    deposit: options.record.deposit + additionalDeposit,
    last_used_at: nowSeconds(),
  });
  await persistSessionReceipt(topUpResponse, options.record.channel_id, options.signedCumulative);

  const paidInit = options.payment.transport.setCredential(
    cloneRequestInit(options.request.init),
    options.credential,
  );
  const retried = await fetchWithRetries(
    { init: paidInit, url: options.paymentRequiredResponse.url || options.request.url },
    options.options,
  );
  await persistSessionReceipt(retried, options.record.channel_id, options.signedCumulative);
  return retried;
}

async function buildTopUpTransaction(options: {
  additionalDeposit: bigint;
  details: SessionDetails;
  identity: PaymentIdentity;
  record: PersistedSessionRecord;
}) {
  const request = buildTopUpTransactionRequest({
    additionalDeposit: options.additionalDeposit,
    details: options.details,
    record: options.record,
  });
  const client = options.identity.getClient({ chainId: options.details.chainId });
  const prepared = await prepareTransactionRequest(
    client as never,
    {
      account: (client as { account: unknown }).account,
      ...request,
    } as never,
  );
  prepared.gas = (prepared.gas ?? 0n) + 5_000n;
  return (await signTransaction(client as never, prepared as never)) as `0x${string}`;
}

export function buildTopUpTransactionRequest(options: {
  additionalDeposit: bigint;
  details: Pick<SessionDetails, "feePayer" | "token">;
  record: Pick<PersistedSessionRecord, "channel_id" | "descriptor_json" | "escrow_contract">;
}) {
  const isPrecompile =
    options.record.escrow_contract.toLowerCase() === TempoChannel.address.toLowerCase();
  const topUpData = encodeFunctionData({
    abi: isPrecompile ? TempoAbis.tip20ChannelReserve : escrowAbi,
    functionName: "topUp",
    args: isPrecompile
      ? [requireSessionDescriptor(options.record), options.additionalDeposit]
      : [options.record.channel_id as `0x${string}`, options.additionalDeposit],
  } as never);
  const calls = isPrecompile
    ? [{ to: options.record.escrow_contract as `0x${string}`, data: topUpData }]
    : [
        {
          to: options.details.token as `0x${string}`,
          data: encodeFunctionData({
            abi: tip20Abi,
            functionName: "approve",
            args: [options.record.escrow_contract as `0x${string}`, options.additionalDeposit],
          }),
        },
        { to: options.record.escrow_contract as `0x${string}`, data: topUpData },
      ];
  return {
    calls,
    ...(options.details.feePayer ? { feePayer: true } : {}),
    feeToken: options.details.token,
  };
}

function topUpRequestInit(init: RequestInitWithDispatcher) {
  const next = cloneRequestInit(init);
  next.method = "POST";
  delete next.body;
  const headers = new Headers(next.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  next.headers = headers;
  return next;
}

function topUpAmountFromProblem(
  body: string,
  record: PersistedSessionRecord,
  signedCumulative: bigint,
) {
  const problem = parseProblemDetails(body);
  if (!problem) return 0n;
  const type = `${problem.type ?? ""} ${problem.title ?? ""} ${problem.detail ?? ""}`.toLowerCase();
  if (!type.includes("insufficient") && !type.includes("exceeds") && !type.includes("deposit"))
    return 0n;
  const requiredTopUp = stringValue(problem.requiredTopUp ?? problem.required_top_up);
  if (/^\d+$/.test(requiredTopUp)) return BigInt(requiredTopUp);
  return signedCumulative > record.deposit ? signedCumulative - record.deposit : 0n;
}

function parseProblemDetails(body: string) {
  try {
    return getRecord(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

const tip20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function sessionDepositRaw(details: SessionDetails, options: RequestOptions) {
  const maxSpend = options.maxSpend ? parseUnits(options.maxSpend, 6) : undefined;
  const preferred = details.suggestedDeposit ?? maxSpend ?? details.amount;
  const deposit = maxSpend && preferred > maxSpend ? maxSpend : preferred;
  if (deposit < details.amount) throw paymentError("Session payment exceeds --max-spend");
  return deposit;
}

async function assertSufficientSessionBalance(
  payer: string,
  details: SessionDetails,
  depositRaw: bigint,
) {
  const client = createTempoPublicClient(details.chainId === 42431 ? "testnet" : undefined);
  const balance = (await Actions.token.getBalance(client as never, {
    account: payer as `0x${string}`,
    token: details.token as `0x${string}`,
  })) as bigint;
  if (balance >= depositRaw) return;
  throw paymentError(
    `Insufficient balance for session deposit: available=${formatTokenAmount(balance)} required=${formatTokenAmount(depositRaw)}`,
  );
}

function sessionRecordFromOpenCredential(options: {
  challenge: Challenge.Challenge;
  credential: string;
  depositRaw: bigint;
  details: SessionDetails;
  identity: PaymentIdentity;
  signedCumulative: bigint;
}): PersistedSessionRecord {
  const parsed = Credential.deserialize<Record<string, unknown>>(options.credential);
  const payload = getRecord(parsed.payload);
  const channelId = stringValue(payload.channelId).toLowerCase();
  if (!channelId) throw paymentError("Session open credential did not include channelId");
  const now = nowSeconds();
  return {
    accepted_cumulative: 0n,
    authorized_signer: stringValue(
      payload.authorizedSigner || options.identity.signerAddress,
    ).toLowerCase(),
    chain_id: options.details.chainId,
    challenge_echo: challengeEchoJson(options.challenge),
    channel_id: channelId,
    close_requested_at: 0,
    created_at: now,
    cumulative_amount: options.signedCumulative,
    deposit: options.depositRaw,
    descriptor_json: payload.descriptor ? JSON.stringify(payload.descriptor) : undefined,
    escrow_contract: options.details.escrowContract,
    grace_ready_at: 0,
    last_used_at: now,
    network: networkName(options.details.chainId) ?? `chain-${options.details.chainId}`,
    origin: options.details.origin,
    payee: options.details.payee,
    payer: options.identity.address.toLowerCase(),
    request_url: options.details.requestUrl,
    salt: "0x00",
    server_spent: 0n,
    session_protocol: sessionProtocol(options.challenge) ?? (payload.descriptor ? "v2" : "v1"),
    state: "active",
    token: options.details.token,
  };
}

function sessionProtocol(challenge: Challenge.Challenge) {
  const request = challenge.request as Record<string, unknown>;
  const methodDetails = getRecord(request.methodDetails);
  return stringValue(methodDetails.sessionProtocol) || undefined;
}

async function persistSessionReceipt(
  response: Response,
  channelId: string,
  signedCumulative: bigint,
) {
  const header = response.headers.get("payment-receipt");
  if (!header) return;
  const receipt = TempoSession.Precompile.Receipt.deserializeSessionReceipt(header);
  if (receipt.method !== "tempo" || receipt.intent !== "session" || receipt.status !== "success")
    return;
  if (receipt.channelId.toLowerCase() !== channelId.toLowerCase()) return;
  const acceptedCumulative = BigInt(receipt.acceptedCumulative);
  const serverSpent = BigInt(receipt.spent);
  if (serverSpent > acceptedCumulative || acceptedCumulative > signedCumulative)
    throw paymentError("Invalid session receipt cumulative values");
  await updateSessionReceipt({
    acceptedCumulative,
    channelId,
    serverSpent,
    signedCumulative,
  });
}

async function readOnChainChannel(record: PersistedSessionRecord) {
  const network = record.chain_id === 42431 ? "testnet" : "mainnet";
  if (record.escrow_contract.toLowerCase() === TempoChannel.address.toLowerCase()) {
    const state = (await createTempoPublicClient(network).readContract({
      address: TempoChannel.address,
      abi: TempoAbis.tip20ChannelReserve,
      functionName: "getChannelState",
      args: [record.channel_id as `0x${string}`],
    })) as unknown;
    const object = getRecord(state);
    const tuple = Array.isArray(state) ? state : [];
    const deposit = parseOnChainBigInt(object.deposit ?? tuple[1]);
    const settled = parseOnChainBigInt(object.settled ?? tuple[0]);
    const closeRequestedAt = parseOnChainBigInt(object.closeRequestedAt ?? tuple[2]);
    if (deposit === 0n) return null;
    return {
      authorizedSigner: record.authorized_signer,
      closeRequestedAt,
      deposit,
      payee: record.payee,
      payer: record.payer,
      settled,
      token: record.token,
    };
  }

  const value = (await createTempoPublicClient(network).readContract({
    address: record.escrow_contract as `0x${string}`,
    abi: escrowAbi,
    functionName: "getChannel",
    args: [record.channel_id as `0x${string}`],
  })) as unknown;
  const object = getRecord(value);
  const tuple = Array.isArray(value) ? value : [];
  if (object.finalized ?? tuple[0]) return null;
  return {
    authorizedSigner: stringValue(object.authorizedSigner ?? tuple[5]),
    closeRequestedAt: parseOnChainBigInt(object.closeRequestedAt ?? tuple[1]),
    deposit: parseOnChainBigInt(object.deposit ?? tuple[6]),
    payee: stringValue(object.payee ?? tuple[3]),
    payer: stringValue(object.payer ?? tuple[2]),
    settled: parseOnChainBigInt(object.settled ?? tuple[7]),
    token: stringValue(object.token ?? tuple[4]),
  };
}

function sessionChallengeFromHeader(header: string | null) {
  if (!header) return undefined;
  try {
    const challenges = Challenge.deserializeList(header).filter(
      (challenge) => challenge.method === "tempo" && challenge.intent === "session",
    );
    return challenges[0];
  } catch {
    return undefined;
  }
}

function challengeEchoJson(challenge: Challenge.Challenge) {
  return JSON.stringify({
    id: challenge.id,
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request: PaymentRequest.serialize(challenge.request),
    ...(challenge.expires ? { expires: challenge.expires } : {}),
    ...(challenge.digest ? { digest: challenge.digest } : {}),
    ...(challenge.opaque ? { opaque: challenge.opaque } : {}),
  });
}

function enforceSessionMaxSpend(cumulativeAmount: bigint, options: RequestOptions) {
  if (!options.maxSpend) return;
  const maxSpend = parseUnits(options.maxSpend, 6);
  if (cumulativeAmount <= maxSpend) return;
  throw paymentError(
    `Payment max spend exceeded: max=${options.maxSpend} required=${formatTokenAmount(cumulativeAmount)}`,
  );
}

function bigintField(value: unknown, name: string) {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw paymentError(`Session challenge is missing ${name}`);
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

async function writeResponseBody(
  response: Response,
  options: RequestOptions,
  stdout: Pick<NodeJS.WriteStream, "write">,
) {
  const outputPath =
    options.output ?? (options.remoteName ? remoteNamePath(options.url) : undefined);
  const includeHeaders = options.includeHeaders || options.head;
  const headerText = includeHeaders ? responseHeaderText(response) : "";

  if (options.head) {
    write(stdout, headerText);
    if (outputPath) await writeFile(outputPath, headerText);
    return;
  }

  if (options.sseJson) {
    const text = await response.text();
    const body = sseToNdjson(text);
    await writeOutput(outputPath, `${headerText}${body}`, stdout);
    return;
  }

  if (options.stream || options.sse) {
    const body = response.body;
    if (!body) return;
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      if (headerText) await writeFile(outputPath, headerText);
      await pipeline(body, createWriteStream(outputPath, { flags: headerText ? "a" : "w" }));
    } else {
      write(stdout, headerText);
      await pipeline(body, process.stdout);
    }
    return;
  }

  const body = await response.text();
  await writeOutput(outputPath, `${headerText}${body}`, stdout);
}

async function writeOutput(
  path: string | undefined,
  text: string,
  stdout: Pick<NodeJS.WriteStream, "write">,
) {
  if (!path) {
    write(stdout, text);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function writeHeadersFile(path: string, response: Response) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, responseHeaderText(response));
}

async function writeMetaFile(path: string, response: Response, started: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        status: response.status,
        url: response.url,
        elapsed_ms: Date.now() - started,
        headers: Object.fromEntries(response.headers.entries()),
      },
      null,
      2,
    )}\n`,
  );
}

function responseHeaderText(response: Response) {
  const lines = [`HTTP ${response.status}`];
  for (const [name, value] of response.headers.entries()) lines.push(`${name}: ${value}`);
  return `${lines.join("\n")}\n\n`;
}

function paymentChallengeError(header: string | null) {
  if (!header)
    return paymentError("Payment required but response is missing WWW-Authenticate header");
  if (!/(^|,)\s*Payment\s/i.test(header))
    return paymentError("Unsupported or malformed payment challenge in WWW-Authenticate header");
  if (!/method="?tempo"?/i.test(header))
    return paymentError("Unsupported payment method in WWW-Authenticate header");
  return undefined;
}

function paymentContext(challenge: { intent: string }, options: RequestOptions) {
  if (challenge.intent !== "session" || !options.maxSpend) return undefined;
  return { depositRaw: parseUnits(options.maxSpend, 6).toString() };
}

function enforceMaxSpend(challenge: { request: Record<string, unknown> }, options: RequestOptions) {
  if (!options.maxSpend) return;
  const amount = challenge.request.amount;
  if (typeof amount !== "string") return;
  const maxSpend = parseUnits(options.maxSpend, 6);
  const required = BigInt(amount);
  if (required <= maxSpend) return;
  throw paymentError(
    `Payment max spend exceeded: max=${options.maxSpend} required=${formatTokenAmount(required)}`,
  );
}

function formatTokenAmount(value: bigint) {
  const whole = value / 1_000_000n;
  const fractional = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function cloneRequestInit(init: RequestInitWithDispatcher): RequestInitWithDispatcher {
  const out: RequestInitWithDispatcher = { headers: new Headers(init.headers) };
  if (init.method !== undefined) out.method = init.method;
  if (init.redirect !== undefined) out.redirect = init.redirect;
  if (init.body !== undefined && init.body !== null) out.body = init.body;
  if (init.signal !== undefined && init.signal !== null) out.signal = init.signal;
  if (init.dispatcher !== undefined) out.dispatcher = init.dispatcher;
  return out;
}

function buildDispatcher(options: RequestOptions): Dispatcher {
  const connect = {
    ...(options.connectTimeout ? { timeout: options.connectTimeout * 1000 } : {}),
    ...(options.insecure ? { rejectUnauthorized: false } : {}),
    ...(options.requestHttp2 ? { allowH2: true, preferH2: true } : {}),
  };
  const agentOptions = {
    ...(options.connectTimeout ? { connectTimeout: options.connectTimeout * 1000 } : {}),
    ...(options.requestHttp1 ? { allowH2: false } : {}),
    ...(options.requestHttp2 ? { allowH2: true } : {}),
    ...(Object.keys(connect).length > 0 ? { connect } : {}),
  };

  if (options.proxy && !options.noProxy)
    return new ProxyAgent({ ...agentOptions, uri: options.proxy });
  if (options.noProxy) return new Agent(agentOptions);
  if (isLoopbackUrl(options.url)) return new Agent(agentOptions);
  return new EnvHttpProxyAgent(agentOptions);
}

function isLoopbackUrl(value: string) {
  const host = new URL(value).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function requireValue(argv: readonly string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || (value.startsWith("-") && value !== "-"))
    throw usageError(`${flag} requires a value`);
  return value;
}

function validateUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw usageError(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw usageError(`Unsupported URL scheme: ${url.protocol.replace(":", "")}`);
}

function validateMethod(method: string) {
  if (!/^[A-Za-z]+$/.test(method)) throw usageError(`Invalid HTTP method: ${method}`);
}

function parsePositiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw usageError(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw usageError(`${flag} must be a non-negative integer`);
  return parsed;
}

function normalizeNetwork(value: string) {
  if (value === "testnet" || value === "tempo-moderato" || value === "moderato") return "testnet";
  if (value === "mainnet" || value === "tempo") return "mainnet";
  throw usageError(`Unsupported network: ${value}`);
}

async function readDataValue(value: string) {
  if (value === "@-") return readStdin();
  if (value.startsWith("@")) return readFile(value.slice(1), "utf8");
  return value;
}

function readStdin() {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(data));
  });
}

function appendQuery(url: URL, data: string) {
  if (!data) return;
  const prefix = url.search ? "&" : "?";
  url.search = `${url.search}${prefix}${data}`;
}

function urlEncodeField(value: string) {
  const separator = value.indexOf("=");
  if (separator < 0) return encodeURIComponent(value);
  return `${value.slice(0, separator)}=${encodeURIComponent(value.slice(separator + 1))}`;
}

async function appendFormField(form: UndiciFormData, field: string) {
  const separator = field.indexOf("=");
  if (separator <= 0) throw usageError(`Invalid form field: ${field}`);
  const name = field.slice(0, separator);
  const value = field.slice(separator + 1);
  if (value.startsWith("@")) {
    const [rawPath, ...attributes] = value.slice(1).split(";");
    if (!rawPath) throw usageError(`Invalid form field: ${field}`);
    const contentType = attributes
      .map((attribute) => attribute.split("="))
      .find(([key]) => key === "type")?.[1];
    const file = new File([await readFile(rawPath)], basename(rawPath), {
      type: contentType ?? "application/octet-stream",
    });
    form.set(name, file, basename(rawPath));
  } else {
    form.set(name, value);
  }
}

function remoteNamePath(value: string) {
  const name = basename(new URL(value).pathname);
  if (!name || name === "." || name === ".." || name.includes("/"))
    throw usageError("Could not derive a safe remote filename from URL");
  return name;
}

function parseRetryStatuses(value: string | undefined, retries: number | undefined) {
  if (!value) return retries ? new Set(defaultRetryStatuses) : new Set<number>();
  return new Set(value.split(",").map((item) => parsePositiveInteger(item.trim(), "--retry-http")));
}

async function waitBeforeRetry(
  response: Response | undefined,
  options: RequestOptions,
  attempt: number,
) {
  const retryAfter =
    response && (options.retryAfter || options.retries !== undefined)
      ? retryAfterMs(response.headers.get("retry-after"))
      : undefined;
  const base = options.retryBackoffMs ?? 250;
  const exponential = Math.min(base * 2 ** attempt, 10_000);
  const jitter = options.retryJitter
    ? Math.floor(exponential * ((Math.random() * options.retryJitter) / 100))
    : 0;
  await sleep(retryAfter ?? exponential + jitter);
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function sseToNdjson(text: string) {
  const lines: string[] = [];
  for (const event of text.split(/\n\n+/)) {
    const eventName =
      event
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.slice("event:".length)
        .trim() || "data";
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data)
      lines.push(
        `${JSON.stringify({ event: eventName, data: parseSseData(data), ts: new Date().toISOString() })}\n`,
      );
  }
  return lines.join("");
}

function parseSseData(data: string) {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function parseSimpleToon(value: string) {
  const out: Record<string, string | number | boolean> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) throw usageError("Failed to decode TOON input");
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    out[key] =
      raw === "true"
        ? true
        : raw === "false"
          ? false
          : /^-?\d+(\.\d+)?$/.test(raw)
            ? Number(raw)
            : raw;
  }
  return out;
}

function write(stdout: Pick<NodeJS.WriteStream, "write">, text: string) {
  stdout.write(text);
}
