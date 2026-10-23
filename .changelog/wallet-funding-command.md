---
tempo-wallet: minor
---

Add `tempo wallet funding list`, which lists cross-chain funding for paid requests that has not been paid with yet as `{ chain_id, network, operations, total }`, each operation with its `id`, `url`, `destination`, lowercase `payer` and `source`, `created_at`, `status` (`not_started`, `claimed`, or `submitted`), `route`, `reference`, `amount_out`, and `max_amount_in`, and `tempo wallet funding recover <id>`, which asks the route how a funding operation stands without sending anything: `completed`, `refunded`, `pending` (with a `_next` to check again), or `action_required`. A settled operation is forgotten, so the request can fund anew.
