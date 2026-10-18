---
tempo-wallet: minor
---

**Breaking:** MCP tools take positional arguments under kebab-case keys, like every option. Renamed keys, old -> new:

- `keys_update` and `revoke`: `accessKey` -> `access-key`.
- `swap`: `tokenIn` -> `token-in`, `tokenOut` -> `token-out`.
- `sessions_close`: `url` -> `target`, which also takes an origin or channel ID.

The old keys are no longer accepted. The new `keys_revoke`, `tx_status`, and `services_show` tools take `access-key`, `tx-hash`, and `service-id`; the deprecated `services` tool keeps `serviceId` until it is removed. The CLI takes these arguments by position as before; `--help` and the README show the new names, and `--describe` names `sessions close`'s argument `target`.
