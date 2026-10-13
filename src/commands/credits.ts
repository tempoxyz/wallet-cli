import { version } from "../shared/constants.js";
import { appUrl, chainId } from "../shared/network.js";
import { escapeInvisible, formatCreditBalance, getRecord, parseAmount } from "../shared/utils.js";
import { isAddress, parseUnits, serializeTypedData, zeroAddress } from "viem";
import { networkError, usageError } from "../shared/errors.js";

// Coinflow's legacy permit authorizes a credit debit, not the redemption calldata.
// Coinflow remains trusted to execute the requested transaction and quote its gas fee.
const creditPermitTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  CreditsAuthorization: [
    { name: "customerWallet", type: "address" },
    { name: "creditSeed", type: "string" },
    { name: "amount", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type CreditsAuthorization = {
  message: string;
  validBefore: string;
  nonce: string;
  creditsRawAmount: number;
};

export function validateCreditPermit(
  auth: CreditsAuthorization,
  options: {
    wallet: string;
    network?: string | undefined;
    amountCents: number;
    maxSpend?: string | undefined;
    capCents?: number | undefined;
  },
) {
  const invalid = () => usageError("Invalid Coinflow credits authorization; refusing to sign");
  let typedData: Record<string, unknown>;
  try {
    typedData = getRecord(JSON.parse(auth.message));
  } catch {
    throw invalid();
  }
  const domain = getRecord(typedData.domain);
  const message = getRecord(typedData.message);
  const types = getRecord(typedData.types);
  const chain = chainId(options.network);
  const uint = (value: unknown) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw invalid();
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value)))
      throw invalid();
    return BigInt(value);
  };
  for (const [name, fields] of Object.entries(creditPermitTypes)) {
    const actual = types[name];
    if (
      !Array.isArray(actual) ||
      actual.length !== fields.length ||
      !fields.every(
        (field, i) =>
          getRecord(actual[i]).name === field.name && getRecord(actual[i]).type === field.type,
      )
    )
      throw invalid();
  }
  if (
    Object.keys(types).length !== 2 ||
    typedData.primaryType !== "CreditsAuthorization" ||
    domain.name !== "Coinflow Credits Contract" ||
    domain.version !== "1" ||
    uint(domain.chainId) !== BigInt(chain) ||
    typeof domain.verifyingContract !== "string" ||
    !isAddress(domain.verifyingContract) ||
    domain.verifyingContract.toLowerCase() === zeroAddress ||
    typeof message.customerWallet !== "string" ||
    message.customerWallet.toLowerCase() !== options.wallet.toLowerCase() ||
    message.creditSeed !== (chain === 4217 ? "tempo" : "tempo-sandbox") ||
    typeof auth.nonce !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce) ||
    message.nonce !== auth.nonce ||
    uint(message.validBefore) !== uint(auth.validBefore) ||
    uint(auth.validBefore) <= BigInt(Math.floor(Date.now() / 1000)) ||
    !Number.isSafeInteger(auth.creditsRawAmount) ||
    auth.creditsRawAmount <= 0 ||
    uint(message.amount) !== BigInt(auth.creditsRawAmount) ||
    BigInt(auth.creditsRawAmount) < BigInt(options.amountCents) * 10_000n
  )
    throw invalid();
  const rawAmount = BigInt(auth.creditsRawAmount);
  if (options.maxSpend !== undefined && rawAmount > parseUnits(options.maxSpend, 6))
    throw usageError(
      `MPP Credits authorization including fees exceeds TEMPO_MAX_SPEND (${options.maxSpend})`,
    );
  if (options.capCents !== undefined && rawAmount > BigInt(options.capCents) * 10_000n)
    throw usageError(
      "MPP Credits authorization including fees exceeds --amount-cents spending cap",
    );
  return serializeTypedData({
    domain: {
      name: "Coinflow Credits Contract",
      version: "1",
      chainId: BigInt(chain),
      verifyingContract: domain.verifyingContract as `0x${string}`,
    },
    types: creditPermitTypes,
    primaryType: "CreditsAuthorization",
    message: {
      customerWallet: options.wallet as `0x${string}`,
      creditSeed: message.creditSeed as string,
      amount: rawAmount,
      validBefore: uint(auth.validBefore),
      nonce: auth.nonce as `0x${string}`,
    },
  });
}

export async function queryCreditBalance(options: {
  walletAddress: string;
}): Promise<{ wallet: string; balance: string; rawBalance: string }> {
  const url = new URL("/api/coinflow/balances", appUrl);
  url.searchParams.set("wallet", options.walletAddress);
  const response = await fetch(url.toString(), {
    headers: {
      "user-agent": `wallet-cli/${version}`,
    },
  });

  if (!response.ok) {
    const body = escapeInvisible((await response.text().catch(() => "")).slice(0, 500));
    throw networkError(
      `Failed to fetch credit balance: HTTP ${response.status}${body ? ` ${body}` : ""}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw networkError("Coinflow balances response is not valid JSON");
  }
  const rawBalance = parseCreditBalance(data);

  return {
    wallet: options.walletAddress,
    balance: formatCreditBalance(rawBalance),
    rawBalance: rawBalance.toString(),
  };
}

function parseCreditBalance(value: unknown) {
  const credits = getRecord(getRecord(value).credits);
  const rawAmount = parseAmount(credits.rawAmount);
  if (rawAmount !== undefined) return rawAmount;

  const cents = parseAmount(credits.cents);
  if (cents !== undefined) return cents * 100n;

  throw networkError("Coinflow balances response is missing credits.rawAmount or credits.cents");
}

export function warnCreditsDeprecated() {
  console.error(
    "--credits is deprecated. Existing MPP Credits remain spendable, but new credits cannot be purchased. Use 'tempo wallet fund --mach' to buy MACH.",
  );
}
