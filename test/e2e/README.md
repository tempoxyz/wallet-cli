# End-to-end tests

`pnpm test:e2e` runs the bundled `tempo request` and `tempo wallet` against local chains. It needs
Docker; `pnpm test` never runs it.

- `compose.yaml` starts `anvil --network tempo` with testnet's chain ID (42431), so the CLI's
  `testnet` network runs against it through `TEMPO_RPC_URL`, and a plain anvil (31338) standing in
  for Base. Adapted from machine-fetch's `test/e2e`.
- `localnet.ts` deploys local OUSD and USDC TIP-20s with DEX books and fee AMM pools on the Tempo
  node, and EIP-3009 USDC (`contracts/LocalToken.sol`, compiled into `LocalToken.json`) on the EVM
  node.
- `wallet.ts` writes a wallet store with an unpublished access key, as `tempo wallet login` leaves
  it.
- `relay.ts` is a stand-in for Relay: `POST /quote/v2` and `GET /intents/status/v3` with Relay's
  shapes. It takes OUSD at a single-use deposit address and releases USDC from inventory on the
  EVM node, and can tamper with quotes or hold deliveries for tests.
- `servers.ts` serves MPP Tempo charges and EVM charges, including x402-only challenges.

Everything runs on loopback, and the loopback guard from `test/fixtures` refuses anything else.
