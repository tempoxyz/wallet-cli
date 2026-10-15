---
wallet-cli: minor
---

`tempo wallet whoami` and `tempo wallet keys list` now read the logged-in wallet's access keys from the AccountKeychain precompile, each on the key's own network, with a 3-second timeout and no retries. Each key reports `published`: whether the chain holds it unrevoked, or `null` when it was not read, as for another stored wallet's keys or a failed read. For a published key whose limits the chain enforces, `spending_limits[]` now report the chain's `remaining` limit and `spent`, the limit less `remaining`, instead of always `null`; an unpublished key, which the chain would read as zero remaining, keeps both `null`. A `pending` key is signed but not yet published on chain and still pays, since its first payment publishes it; one the chain already holds is now reported `ready`. `whoami`'s `ready` follows the reported key status, so the two never disagree.

The singular `spending_limit` on `whoami` and `keys list` keys is deprecated and will be removed in a future release; use `spending_limits`. Until then it repeats `spending_limits[0]` with the key's spending `mode`, including for legacy keys whose limit it previously reported as `null`. `whoami --mach` now reports its token address, and `whoami --credits` its wallet, in lowercase like the rest of the output.
