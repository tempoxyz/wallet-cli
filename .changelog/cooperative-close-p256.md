---
wallet-cli: patch
---

`tempo wallet sessions close --cooperative` now works with the P-256 access key that `tempo wallet login` creates, whether stored as key material or as a WebCrypto keystore handle, and against TIP-1034 precompile channels. The close credential now carries the channel `descriptor` and the `closeSignature` cooperative-close authorization that mppx 0.17 servers require. Both the voucher and the authorization are signed by the bare access key (a primitive secp256k1 or P-256 signature, not a keychain wrapper). Before, it failed with "cooperative close requires a local secp256k1 session access key", and with a secp256k1 key the server answered "Credential payload is invalid". Legacy escrow channels still need a secp256k1 key, because the escrow recovers the signer with ecrecover.
