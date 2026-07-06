import { readFile } from "node:fs/promises";

import { encodeFunctionData, keccak256, parseUnits, serializeTypedData } from "viem";
import { Actions } from "viem/tempo";

import { usdcToken, moderatoToken, version } from "../shared/constants.js";
import { networkError, usageError } from "../shared/errors.js";
import { authUrl, chainId, tokenDecimals, tokenSymbol } from "../shared/network.js";
import { decodeBase64UrlJson, getRecord, stringValue } from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { loadWalletState } from "../wallet/store.js";

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
  const call = Actions.token.transfer.call({
    amount: parseUnits(args.amount, tokenDecimals(args.token)),
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

export async function transferCredits(options: {
  options: {
    network?: string | undefined;
    address?: string | undefined;
    "dry-run"?: boolean | undefined;
    "amount-cents"?: number | undefined;
    to?: string | undefined;
    data?: string | undefined;
    value?: string | undefined;
    "mpp-challenge"?: string | undefined;
    "mpp-challenge-file"?: string | undefined;
    "mpp-client-id"?: string | undefined;
  };
}) {
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

  if (options.options["dry-run"]) {
    return {
      wallet,
      amount_cents: amountCents,
      dry_run: true,
    };
  }

  const baseUrl = apiBaseUrl(authUrl(chainId(options.options.network)));
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
  const redeem = await submitCreditsRedeem({
    baseUrl,
    wallet,
    amountCents,
    transactionData,
    auth,
    signature,
  });
  const txHash = stringValue(getRecord(redeem).hash);
  if (!txHash)
    throw new Error("Credits redeem submitted but response did not include a transaction hash");

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
  if (token !== usdcToken && token !== moderatoToken)
    throw usageError(`Invalid configuration: MPP challenge currency ${token} is not a supported USDC.e token`);
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
  const request = params.request ? decodeBase64UrlJson(params.request) : null;
  if (!request)
    throw usageError("Invalid configuration: invalid MPP challenge: Missing request parameter.");

  return {
    id: params.id ?? "",
    realm: params.realm ?? "",
    method: params.method ?? "",
    intent: params.intent ?? "",
    request,
    expires: params.expires,
  };
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
