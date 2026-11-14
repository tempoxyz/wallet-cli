---
wallet-cli: patch
---

`tempo wallet sessions list --orphaned` (and `--all`), `sessions close --orphaned`, and `sessions close <channel-id>` now find TIP-1034 precompile channels the logged-in wallet pays from that have no local record, such as channels another client opened with the same wallet. Discovery reads the precompile's `ChannelOpened` logs filtered on the payer, in block ranges of 50,000 from the precompile's first channel on the chain, keeps channels that still hold a deposit, and stores each with the channel descriptor rebuilt from its event, so `sessions close` can request the close and withdraw the deposit. Later scans resume after the last block a completed scan covered. Before, only legacy escrow channels opened in the last 100,000 blocks were discovered, and closing such a channel by ID reported "channel not found".
