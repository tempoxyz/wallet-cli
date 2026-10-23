---
tempo-request: minor
---

`tempo request` now checks every one-time charge against its spending policy through machine-fetch before it signs. `--max-spend` caps the USD tokens the CLI lists for the network (such as pathUSD and USDC.e) at the same amount as before. **Behavior change:** a charge in any other token, which `--max-spend` previously compared as if it had six decimals, is now refused before signing with `E_LIMIT_EXCEEDED` ("--max-spend cannot cap a payment in <token>"). Zero-amount proofs, subscriptions, and sessions are unchanged.
