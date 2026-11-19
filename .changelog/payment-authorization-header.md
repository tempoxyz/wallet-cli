---
wallet-cli: patch
---

`tempo request` now sends the payment credential in `Payment-Authorization` when the 402 challenge selects it (`header="Payment-Authorization"`), on charge and session retries and session top-ups, and keeps the app's own `Authorization` header. `tempo wallet sessions close --cooperative` sends the close credential in the field the stored challenge selects. Before, credentials always went in `Authorization`, so such servers answered with another 402.
