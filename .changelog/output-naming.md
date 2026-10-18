---
wallet-cli: minor
---

**Breaking:** output keys and values follow one naming and format style. Renamed keys and changed values, old -> new:

- `login`, `login status`, and `refresh`: `chainId` -> `chain_id`, with `network` added beside it; `accounts` are lowercase.
- `sessions close --dry-run`: `targets[].state` -> `targets[].status`, with the lowercase values `sessions list` reports (`Active` -> `active`, `Closing` -> `closing`, `Finalizable` -> `finalizable`, `Orphaned` -> `orphaned`, `not found` -> `not_found`); the result adds `status: "dry_run"`.
- `transfer --mach` and `transfer --credits`: `dry_run: true` -> `status: "dry_run"`; a sent payment adds `status: "success"`.
- Service details (`services <id>`, now `services show <id>`, and the MCP `services` tool): `docs.llmsTxt` -> `docs.llms_txt`, `docs.apiReference` -> `docs.api_reference`, `endpoints[].payment.unitType` -> `endpoints[].payment.unit_type`, and `endpoints[].payment.amount` (base units) -> `endpoints[].payment.raw_amount`; `price` keeps the amount in whole tokens.
- `sessions list` and `sessions close`: `remaining_secs` -> `remaining_seconds`.
- Access keys in `whoami` `key`, `keys list`, and `revoke --dry-run` `key`: `wallet_address` -> `wallet`.
- `tempo request --dry-run`: `amount_raw` -> `raw_amount`, `deposit_raw` -> `raw_deposit`; `token` and `signer.address` are lowercase, and `network` is added beside `chain_id`. `transfer --mach`: `amount_raw` -> `raw_amount`.
- Token amounts use minimal decimals (`"10"`, not `"10.000000"`): sessions `deposit`, `spent`, and `remaining`; `whoami` `balance.total`, `locked`, and `pending_refund`; and key `spending_limits[].limit` and `spending_limit.limit` (`"0"` for a key that cannot spend).
- `tempo request` receipts and `--output` metadata: `payer` and `signer.address` are lowercase.

Output schemas now type session `status` (`active`, `closing`, `finalizable`, `finalized`, `orphaned`), key `status` (`ready`, `pending`, `expired`, `unusable`), the `sessions close --dry-run` targets, and the `services show` docs and endpoints, and describe the HTTP `status` of a `tempo request --dry-run` probe that needed no payment.
