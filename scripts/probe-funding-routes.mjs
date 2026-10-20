// Quote-only probe of the CLI's Relay and Stargate routes against mainnet. It never signs or sends:
// every route's `execute` throws, and only `quote()` runs (Relay's includes the CLI's guarantees
// check). Usage: pnpm build && node scripts/probe-funding-routes.mjs [sourceAccount] [payer]
import { relayDepositRoute } from "../dist/payment/upstream/relay-route.js";
import { stargateRoute } from "../dist/payment/upstream/stargate-route.js";
import {
  crossChainSources,
  destinations,
  relayDepository,
  stargateConfig,
} from "../dist/shared/chains.js";
import { createTempoPublicClient } from "../dist/shared/network.js";
import { tokenSymbol } from "../dist/shared/tokens.js";

const tempo = 4217;
const [
  source = "0x41d8fa0f3032e12ccf3c3d75776685bb740a8381",
  payer = "0x3e389BaD81a66d163ef35576b3e0CdBacd1d27A3",
] = process.argv.slice(2);
const base = destinations(tempo).find((entry) => entry.name === "base");
const never = async () => {
  throw new Error("probe must never send");
};
const fmt = (value) => (Number(value) / 1e6).toFixed(6);

const chains = await (await fetch("https://api.relay.link/chains")).json();
const listed = chains.chains.find((chain) => chain.id === tempo)?.protocol?.v2?.depository;
const pinned = relayDepository(tempo);
console.log(
  `Relay depository: pinned ${pinned}, Relay lists ${listed} -> ${listed?.toLowerCase() === pinned.toLowerCase() ? "match" : "MISMATCH"}`,
);

const stargate = stargateConfig(tempo);
const client = createTempoPublicClient(tempo);
for (const asset of crossChainSources(tempo)) {
  const symbol = tokenSymbol(asset, tempo) ?? asset;
  const routes = [relayDepositRoute({ depository: pinned, maxGas: 20_000n, execute: never })];
  if (stargate.token.toLowerCase() === asset.toLowerCase())
    routes.push(
      stargateRoute({
        ...stargate,
        destinationToken: (chainId) =>
          destinations(tempo).find((d) => d.chainId === chainId)?.usdc.address,
        client,
        maxGas: 20_000n,
        execute: never,
      }),
    );
  for (const amountOut of [10_000n, 1_000_000n, 5_000_000n]) {
    const request = {
      operationId: `probe-${crypto.randomUUID()}`,
      amountOut,
      deadline: Math.floor(Date.now() / 1000) + 120,
      from: {
        owner: source,
        asset,
        chainId: tempo,
        currency: "USD",
        decimals: 6,
        network: `eip155:${tempo}`,
      },
      to: {
        owner: payer,
        asset: base.usdc.address,
        chainId: base.chainId,
        currency: "USD",
        decimals: 6,
        network: base.network,
      },
      maxSlippageBps: 50,
      signal: AbortSignal.timeout(20_000),
    };
    const results = await Promise.all(
      routes.map((route) =>
        route.quote(request).then(
          (quote) =>
            `${route.name}: debit ${fmt(quote.amountIn)} (cost ${fmt(quote.amountIn - amountOut)})`,
          (error) => `${route.name}: REFUSED ${String(error?.message).slice(0, 160)}`,
        ),
      ),
    );
    console.log(`${symbol} -> ${fmt(amountOut)} Base USDC | ${results.join(" | ")}`);
  }
}
