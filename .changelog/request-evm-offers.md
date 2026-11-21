---
tempo-request: minor
tempo-wallet: minor
---

`tempo request` can pay EVM offers: x402 `exact` payments and MPP `evm` charges in USDC on Base (Base Sepolia on testnet).

- **Who pays:** the wallet's remote payer, a secp256k1 key the CLI creates for the wallet on first use, or the `--private-key` signer.
  - The wallet keystore creates the payer key, and the wallet store keeps it with the access keys as the `tempo-cli.remotePayers` item.
  - `~/.tempo/wallet/remote-payers.json`, readable only by you, is a write-once backup that restores a payer the store loses.
  - Logout keeps the payer, and the key never appears in output.
  - `tempo wallet keys list` shows the active wallet's payer.
- **Checks before signing:** an offer on another chain, in another token, or for another EIP-3009 domain is refused. `--max-spend` caps USDC like other USD tokens.
- **Choosing an offer:** when a server offers both, the CLI ranks a Tempo offer first if the wallet holds its token or can swap for it, then a Base offer the payer already holds the USDC for. `--payment-network tempo|base` chooses one.
- **`--funding off`:** pays a Tempo offer when there is one. Otherwise it pays the EVM offer from USDC the payer already holds, and never bridges.
- **Receipts:** a paid EVM request's receipt records the settlement `tx_hash`, from the server's x402 `payment-response` or MPP `evm` receipt.
- `TEMPO_BASE_RPC_URL` sets the Base RPC endpoint.
