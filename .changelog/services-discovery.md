---
wallet-cli: minor
---

Make `tempo wallet services` discovery easier to use: cache the service directory for 10 minutes and fall back to the cached copy (marked `stale` with `fetched_at`) when the fetch fails, add `--refresh` to bypass the cache, match every word of `--search` independently across id, name, description, tags, and categories, add a formatted `price` to each endpoint payment, and suggest close ids when a service is not found (now `E_NOT_FOUND`).
