---
tempo-wallet: minor
---

Add `tempo wallet balance [--token <symbol|address>]` and `tempo wallet address [--qr]`. `balance` prints the logged-in wallet's token balances on the resolved network as `{ address, chain_id, network, balances: [{ token, symbol, decimals, balance, verified }] }`: each token the wallet app reports, plus the network's default token (USDC.e on mainnet, pathUSD on testnet) read on chain even at zero. `--token` shows only that token, read on chain in its own decimals; an unreadable balance returns retryable `E_NETWORK`. Session deposits are held in escrow, so locked and pending-refund amounts stay in `whoami`. `address` prints `{ address, chain_id, network }`; on a terminal, `--qr` also draws a QR code of the address for receiving funds, while agent and JSON output stay the same. Both need a login but no access key, return `E_NOT_AUTHENTICATED` with a login `cta` without one, and are read-only MCP tools; `address` makes no network request.
