---
tempo-request: minor
---

`tempo request` can pay EVM offers: x402 `exact` payments and MPP `evm` charges in USDC on Base (Base Sepolia on testnet). They are paid from the wallet's remote payer, a key the CLI creates for the wallet on first use and keeps in `~/.tempo/wallet/remote-payers.json`, readable only by you, or from the `--private-key` signer. An offer on another chain, in another token, or for another EIP-3009 domain is refused before signing, and `--max-spend` caps USDC like other USD tokens. When a server offers both, a Tempo offer the wallet holds the token for, or can swap for, comes first, then a Base offer the payer already holds the USDC for; `--payment-network tempo|base` chooses one. `--funding off` ignores EVM offers as before. `TEMPO_BASE_RPC_URL` sets the Base RPC endpoint.
