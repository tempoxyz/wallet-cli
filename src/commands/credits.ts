import { version } from "../shared/constants.js";
import { authUrl } from "../shared/network.js";
import { formatCreditBalance, getRecord, parseAmount } from "../shared/utils.js";

export async function queryCreditBalance(options: {
  chainId: number | null;
  walletAddress: string;
}): Promise<{ wallet: string; balance: string; rawBalance: string }> {
  const url = coinflowBalancesUrl(authUrl(options.chainId), options.walletAddress);
  const response = await fetch(url, {
    headers: {
      "user-agent": `wallet-cli/${version}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch credit balance: HTTP ${response.status}${body ? ` ${body}` : ""}`,
    );
  }

  const rawBalance = parseCreditBalance((await response.json()) as unknown);

  return {
    wallet: options.walletAddress,
    balance: formatCreditBalance(rawBalance),
    rawBalance: rawBalance.toString(),
  };
}

function coinflowBalancesUrl(authUrl: string, walletAddress: string) {
  const url = new URL(authUrl);
  url.pathname = "/api/coinflow/balances";
  url.search = "";
  url.searchParams.set("wallet", walletAddress);
  return url.toString();
}

function parseCreditBalance(value: unknown) {
  const credits = getRecord(getRecord(value).credits);
  const rawAmount = parseAmount(credits.rawAmount);
  if (rawAmount !== undefined) return rawAmount;

  const cents = parseAmount(credits.cents);
  if (cents !== undefined) return cents * 100n;

  throw new Error("Coinflow balances response is missing credits.rawAmount or credits.cents");
}
