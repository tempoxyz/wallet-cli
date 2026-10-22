// Quote-only probe of machine-fetch's own Relay and Stargate routes on mainnet, from the logged-in
// wallet's address on Tempo to its remote payer on Base. Nothing is signed or sent: `quote` reads
// Relay's API, the chain registry, the OFT's quotes, balances, and gas estimates only.
//
//   node scripts/probe-funding-routes.mjs <tempo-owner> <base-payer> [amountOut atomic]
import { RelayProtocolRoute } from "machine-fetch/relay";
import { StargateRoute } from "machine-fetch/stargate";
import { createPublicClient, http } from "viem";
import { base, tempo } from "viem/chains";

const [owner, payer, amount = "10000"] = process.argv.slice(2);
if (!owner || !payer) throw new Error("usage: probe-funding-routes.mjs <tempo-owner> <base-payer>");
const clients = {
  4217: createPublicClient({ chain: tempo, transport: http("https://rpc.tempo.xyz") }),
  8453: createPublicClient({ chain: base, transport: http("https://mainnet.base.org") }),
};
const usdce = "0x20C000000000000000000000b9537d11c60E8b50";
const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const request = (asset) => ({
  amountOut: BigInt(amount),
  deadline: Math.floor(Date.now() / 1000) + 300,
  from: { owner, asset, chainId: 4217, currency: "USD", decimals: 6, network: "eip155:4217" },
  maxSlippageBps: 50,
  operationId: `probe-${Date.now()}`,
  signal: AbortSignal.timeout(30_000),
  to: { owner: payer, asset: baseUsdc, chainId: 8453, currency: "USD", decimals: 6, network: "eip155:8453" },
});
const show = (name, quote) =>
  console.log(
    `${name}: amountIn ${quote.amountIn} maxAmountIn ${quote.maxAmountIn} fees ${JSON.stringify(
      quote.fees.map((fee) => ({ kind: fee.kind, amount: String(fee.amount), included: fee.includedInAmountIn })),
    )}`,
  );
const relay = RelayProtocolRoute.create({
  name: "relay",
  clients,
  depositories: { 4217: "0x4cD00E387622C35bDDB9b4c962C136462338BC31" },
  balance: true,
});
for (const [label, asset] of [["USDC.e", usdce], ["OUSD", ousd]])
  await relay
    .quote(request(asset))
    .then((quote) => show(`relay from ${label}`, quote))
    .catch((error) => console.log(`relay from ${label}: REFUSED ${error.name}: ${error.shortMessage ?? error.message}`));
const stargate = StargateRoute.create({ ...StargateRoute.tempoUsdce, clients, balance: true });
await stargate
  .quote(request(usdce))
  .then((quote) => show("stargate from USDC.e", quote))
  .catch((error) => console.log(`stargate from USDC.e: REFUSED ${error.name}: ${error.shortMessage ?? error.message}`));
