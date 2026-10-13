import { readFile } from "node:fs/promises";

import { encodeFunctionData, formatUnits, isAddress, keccak256, parseUnits, serializeTypedData, zeroAddress } from "viem";
import { Credential } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { Actions } from "viem/tempo";

import { networkError, paymentOutcomeUnknownError, usageError } from "../shared/errors.js";
import { appUrl, chainId, tokenAddress, tokenDecimals, tokenSymbol } from "../shared/network.js";
import { escapeInvisible, getRecord, stringValue } from "../shared/utils.js";
import { version } from "../shared/constants.js";
import { warnCreditsDeprecated } from "./credits.js";
import { createProvider } from "../provider.js";
import { loadWalletState } from "../wallet/store.js";
import {
  parseRequestArgs,
  preparePaymentChallenge,
  resolvePaymentIdentity,
  resolveMaxSpend,
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
  if (args.amount === undefined || args.token === undefined || args.to === undefined) {
    const missing = (["amount", "token", "to"] as const).filter((name) => args[name] === undefined);
    throw usageError(
      `missing ${missing.map((name) => `<${name}>`).join(", ")}; usage: tempo wallet transfer <amount> <token> <to>`,
    );
  }
  const amount = parseTransferAmount(args.amount);
  if (!isAddress(args.token)) throw usageError("Invalid token address: expected a full 0x address");
  if (!isAddress(args.to))
    throw usageError("Invalid recipient address: expected a full 0x address");
  if (args.to.toLowerCase() === zeroAddress)
    throw usageError("Invalid recipient address: cannot transfer to the zero address");

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
    amount,
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
  if (!txHash)
    throw paymentOutcomeUnknownError(
      "Transfer submitted but receipt did not include a transaction hash; check the wallet balance before retrying.",
    );

  return {
    status: "success" as const,
    tx_hash: txHash,
    ...outputBase,
  };
}

function parseTransferAmount(value: string) {
  const decimals = tokenDecimals();
  const amount = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)
    ? parseUnits(value, decimals)
    : 0n;
  if (amount <= 0n)
    throw usageError(
      `Invalid amount: expected a positive decimal with at most ${decimals} decimals`,
    );
  return amount;
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
  let paymentToken: string = "MACH";
  const payment = Mppx.create({
    methods: [
      tempo.charge({
        ...identity.methodOptions,
        getClient: identity.getClient,
        expectedChainId: chainId(requestOptions.network),
        // Observe the SDK's chosen calls only to report the funding token.
        // mppx owns MACH preference and settlement-currency fallback.
        resolveAccount({ account, operation }) {
          if (operation.kind === "executeCalls")
            paymentToken =
              operation.calls?.[0]?.to.toLowerCase() === output.settlement_currency.toLowerCase()
                ? output.settlement_currency
                : "MACH";
          return account;
        },
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
      `MACH settlement did not return a confirmed result. Check challenge ${escapeInvisible(JSON.stringify(challenge.id))} with the provider before retrying.`,
    );
  }
  const { payload } = Credential.deserialize<{ type: string; hash?: string }>(credential);
  if (payload.type !== "hash" || !payload.hash || !/^0x[0-9a-fA-F]{64}$/.test(payload.hash))
    throw paymentOutcomeUnknownError(
      "MACH settlement did not return a transaction hash; check with the provider before retrying.",
    );
  return {
    ...output,
    token: paymentToken,
    wallet: identity.address.toLowerCase(),
    tx_hash: payload.hash,
  };
}

export async function transferCredits(options: {
  options: {
    network?: string | undefined;
    address?: string | undefined;
    "dry-run"?: boolean | undefined;
    "amount-cents"?: number | undefined;
    "max-spend"?: string | undefined;
    to?: string | undefined;
    data?: string | undefined;
    value?: string | undefined;
    "mpp-challenge"?: string | undefined;
    "mpp-challenge-file"?: string | undefined;
    "mpp-client-id"?: string | undefined;
  };
}) {
  warnCreditsDeprecated();
  if (options.options["max-spend"] !== undefined)
    throw usageError(
      "--max-spend is only supported with --mach; use --amount-cents with --credits",
    );
  const flags = options.options;
  if (
    (flags["mpp-challenge"] !== undefined || flags["mpp-challenge-file"] !== undefined) &&
    (flags.to !== undefined || flags.data !== undefined || flags.value !== undefined)
  )
    throw usageError("--to, --data, and --value cannot be combined with an MPP challenge");
  const maxSpend = resolveMaxSpend();
  const cents = options.options["amount-cents"];
  if (cents !== undefined && (!Number.isSafeInteger(cents) || cents <= 0))
    throw usageError("--amount-cents must be a positive safe integer");
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const wallet = (options.options.address ?? activeAccount?.address)?.toLowerCase();
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  if (!wallet)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  const challenge = await mppChallengeInput(options.options);
  const creditsTransfer = challenge
    ? buildMppCreditsTransfer({
        challenge,
        clientId: options.options["mpp-client-id"],
        network: options.options.network,
      })
    : buildDirectCreditsTransfer(options.options);

  const { amountCents, transactionData } = creditsTransfer;
  if (challenge && cents !== undefined && amountCents > cents)
    throw usageError("MPP challenge exceeds --amount-cents spending cap");
  if (maxSpend !== undefined && BigInt(amountCents) * 10_000n > parseUnits(maxSpend, 6))
    throw usageError(`MPP Credits payment exceeds TEMPO_MAX_SPEND (${maxSpend})`);

  if (options.options["dry-run"]) {
    return {
      wallet,
      amount_cents: amountCents,
      dry_run: true,
    };
  }

  const baseUrl = apiBaseUrl(appUrl);
  const provider = createProvider({ network: options.options.network });
  const auth = await requestCreditsAuthMessage({
    baseUrl,
    wallet,
    amountCents,
    transactionData,
  });
  const typedData = JSON.parse(auth.message) as Parameters<typeof serializeTypedData>[0];
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [wallet as `0x${string}`, serializeTypedData(typedData)],
  });
  let redeem: unknown;
  try {
    redeem = await submitCreditsRedeem({
      baseUrl,
      wallet,
      amountCents,
      transactionData,
      auth,
      signature,
    });
  } catch {
    // The permit may have been redeemed even if the response was lost. Never retry automatically.
    throw paymentOutcomeUnknownError(
      "MPP Credits redemption did not return a confirmed result. Check your wallet activity before retrying.",
    );
  }
  const txHash = stringValue(getRecord(redeem).hash);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
    throw paymentOutcomeUnknownError(
      "MPP Credits redemption did not return a transaction hash. Check your wallet activity before retrying.",
    );

  return {
    wallet,
    amount_cents: amountCents,
    tx_hash: txHash,
  };
}

async function mppChallengeInput(options: {
  "mpp-challenge"?: string | undefined;
  "mpp-challenge-file"?: string | undefined;
}) {
  if (options["mpp-challenge"] && options["mpp-challenge-file"])
    throw usageError("Use only one of --mpp-challenge and --mpp-challenge-file");
  if (options["mpp-challenge"]) return options["mpp-challenge"];
  if (options["mpp-challenge-file"]) return readFile(options["mpp-challenge-file"], "utf8");
  return null;
}

function buildDirectCreditsTransfer(options: {
  "amount-cents"?: number | undefined;
  to?: string | undefined;
  data?: string | undefined;
  value?: string | undefined;
}) {
  const amountCents = options["amount-cents"];
  const to = options.to;
  if (!Number.isSafeInteger(amountCents) || amountCents === undefined || !to)
    throw usageError(
      "Configuration missing: --amount-cents and --to are required when using --credits, unless --mpp-challenge is provided",
    );

  const transactionData = buildCreditsTransactionData({
    to,
    data: options.data ?? "0x",
    value: options.value ?? "0",
  });

  return { amountCents, transactionData };
}

function buildMppCreditsTransfer(options: {
  challenge: string;
  clientId?: string | undefined;
  network?: string | undefined;
}) {
  const challenge = parseMppChallenge(options.challenge);
  if (challenge.method !== "tempo")
    throw usageError(
      `Invalid configuration: unsupported MPP method for Coinflow credits: ${challenge.method}`,
    );
  if (challenge.intent !== "charge")
    throw usageError(
      `Invalid configuration: unsupported MPP intent for Coinflow credits: ${challenge.intent}`,
    );
  if (challenge.expires && Date.parse(challenge.expires) <= Date.now())
    throw usageError("Invalid configuration: MPP challenge is expired");

  const request = challenge.request;
  const amount = stringValue(request.amount);
  const token = stringValue(request.currency).toLowerCase();
  const recipient = stringValue(request.recipient).toLowerCase();
  const methodDetails = getRecord(request.methodDetails);
  const requestChainId = typeof methodDetails.chainId === "number" ? methodDetails.chainId : null;
  const selectedChainId = chainId(options.network);

  if (requestChainId !== null && requestChainId !== selectedChainId)
    throw usageError(
      `Invalid configuration: MPP challenge is for chain ${requestChainId}, but selected chain is ${selectedChainId}`,
    );
  const selectedToken = tokenAddress(selectedChainId);
  if (token !== selectedToken)
    throw usageError(
      `Invalid configuration: MPP challenge currency ${token} does not match token ${selectedToken} for chain ${selectedChainId}`,
    );
  if (!/^0x[0-9a-f]{40}$/.test(recipient))
    throw usageError("Invalid configuration: MPP challenge is missing a recipient address");
  if (!/^\d+$/.test(amount))
    throw usageError(`Invalid configuration: invalid MPP amount: ${amount}`);

  const atomicAmount = BigInt(amount);
  const amountCents = amountToUsdCents(atomicAmount);
  const data = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "transferWithMemo",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "memo", type: "bytes32" },
        ],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
      },
    ],
    functionName: "transferWithMemo",
    args: [
      recipient as `0x${string}`,
      atomicAmount,
      mppAttributionMemo(challenge, options.clientId),
    ],
  });

  return {
    amountCents,
    transactionData: buildCreditsTransactionData({
      to: token,
      data,
      value: "0",
    }),
  };
}

function buildCreditsTransactionData(options: { to: string; data: string; value: string }) {
  if (!isZeroValue(options.value))
    throw usageError(
      "Invalid configuration: Coinflow credits redeem does not support non-zero ETH value",
    );

  if (options.data === "0x") {
    return {
      type: "token",
      destination: options.to,
    };
  }

  return {
    transaction: {
      to: options.to,
      data: options.data,
    },
  };
}

function isZeroValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const hex = trimmed.match(/^0x([0-9a-fA-F]*)$/);
  if (hex) return !hex[1] || /^0+$/.test(hex[1]);
  if (!/^\d+$/.test(trimmed)) throw new Error(`Invalid ETH value: ${value}`);
  return /^0+$/.test(trimmed);
}

function parseMppChallenge(input: string) {
  const header = mppHeaderValue(input);
  const paymentIndex = header.indexOf("Payment");
  if (paymentIndex < 0)
    throw usageError("Invalid configuration: invalid MPP challenge: Expected 'Payment' scheme.");

  const params = parseAuthParams(header.slice(paymentIndex + "Payment".length));
  if (!params.request)
    throw usageError("Invalid configuration: invalid MPP challenge: Missing request parameter.");

  const request = mppChallengeRequest(params.request);
  if (!request)
    throw usageError("Invalid configuration: invalid MPP challenge: Malformed request parameter.");

  return {
    id: params.id ?? "",
    realm: params.realm ?? "",
    method: params.method ?? "",
    intent: params.intent ?? "",
    request,
    expires: params.expires,
  };
}

function mppChallengeRequest(value: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  return decoded as Record<string, unknown>;
}

function mppHeaderValue(input: string) {
  const trimmed = input.trim();
  for (const line of trimmed.split(/\r?\n/)) {
    const [name, ...rest] = line.split(":");
    if (name?.trim().toLowerCase() === "www-authenticate") return rest.join(":").trim();
  }
  return trimmed;
}

function parseAuthParams(input: string) {
  const result: Record<string, string> = {};
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index] ?? "")) index++;
    if (index >= input.length) break;

    const keyStart = index;
    while (index < input.length && /[A-Za-z0-9_-]/.test(input[index] ?? "")) index++;
    const key = input.slice(keyStart, index);
    while (index < input.length && /\s/.test(input[index] ?? "")) index++;
    if (input[index] !== "=") break;
    index++;
    while (index < input.length && /\s/.test(input[index] ?? "")) index++;

    const [value, nextIndex] = readAuthParamValue(input, index);
    index = nextIndex;
    if (key in result)
      throw usageError(
        `Invalid configuration: invalid MPP challenge: Duplicate parameter: ${key}.`,
      );
    result[key] = value;
  }

  return result;
}

function readAuthParamValue(input: string, start: number): readonly [string, number] {
  if (input[start] !== '"') {
    let index = start;
    while (index < input.length && !/[\s,]/.test(input[index] ?? "")) index++;
    return [input.slice(start, index), index];
  }

  let index = start + 1;
  let value = "";
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      const next = input[index + 1];
      if (next !== undefined) value += next;
      index += 2;
      continue;
    }
    if (char === '"') return [value, index + 1];
    value += char;
    index++;
  }

  throw usageError("Invalid configuration: invalid MPP challenge: Unterminated quoted string.");
}

function amountToUsdCents(amountAtomic: bigint) {
  if (amountAtomic === 0n)
    throw usageError("Invalid configuration: MPP challenge amount must be greater than zero");
  const baseUnitsPerCent = 10_000n;
  if (amountAtomic % baseUnitsPerCent !== 0n)
    throw usageError(
      `Invalid configuration: MPP challenge amount ${amountAtomic.toString()} cannot be represented exactly in Coinflow credits cents for a 6-decimal token`,
    );
  const cents = amountAtomic / baseUnitsPerCent;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw usageError(
      `Invalid configuration: MPP challenge amount ${amountAtomic.toString()} is too large for Coinflow credits`,
    );
  return Number(cents);
}

function mppAttributionMemo(
  challenge: { id: string; realm: string },
  clientId: string | undefined,
): `0x${string}` {
  const bytes = new Uint8Array(32);
  bytes.set(hashPrefix("mpp", 4), 0);
  bytes[4] = 0x01;
  bytes.set(hashPrefix(challenge.realm, 10), 5);
  if (clientId) bytes.set(hashPrefix(clientId, 10), 15);
  bytes.set(hashPrefix(challenge.id, 7), 25);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function hashPrefix(value: string, length: number) {
  return Buffer.from(keccak256(new TextEncoder().encode(value)).slice(2), "hex").subarray(
    0,
    length,
  );
}

async function requestCreditsAuthMessage(options: {
  baseUrl: string;
  wallet: string;
  amountCents: number;
  transactionData: unknown;
}) {
  const response = await fetch(`${options.baseUrl}/api/coinflow/redeem/auth-msg`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": `wallet-cli/${version}`,
    },
    body: JSON.stringify({
      wallet: options.wallet,
      subtotal: {
        cents: options.amountCents,
        currency: "USD",
      },
      transactionData: options.transactionData,
    }),
  });
  const text = await response.text();
  if (!response.ok)
    throw networkError(`HTTP ${response.status} during get credits auth message: ${text}`);

  return getRecord(JSON.parse(text)) as {
    message: string;
    validBefore: string;
    nonce: string;
    creditsRawAmount: number;
  };
}

async function submitCreditsRedeem(options: {
  baseUrl: string;
  wallet: string;
  amountCents: number;
  transactionData: unknown;
  auth: { validBefore: string; nonce: string; creditsRawAmount: number };
  signature: string;
}) {
  const response = await fetch(`${options.baseUrl}/api/coinflow/redeem/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": `wallet-cli/${version}`,
    },
    body: JSON.stringify({
      wallet: options.wallet,
      subtotal: {
        cents: options.amountCents,
        currency: "USD",
      },
      transactionData: options.transactionData,
      permitCreditsSignature: options.signature,
      validBefore: options.auth.validBefore,
      nonce: options.auth.nonce,
      creditsRawAmount: options.auth.creditsRawAmount,
    }),
  });
  const text = await response.text();
  if (!response.ok)
    throw networkError(`HTTP ${response.status} during send redeem transaction: ${text}`);

  return JSON.parse(text) as unknown;
}

function apiBaseUrl(urlString: string) {
  return new URL(urlString).origin;
}
