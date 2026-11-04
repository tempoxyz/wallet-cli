---
wallet-cli: patch
---

Releases no longer ship a macOS Intel (darwin-amd64) build of `tempo-wallet` or `tempo-request`; Linux x64, Linux arm64 and Apple silicon Macs are still built. Release builds also run types and tests once instead of in every binary job, and build both binaries in one job per platform.
