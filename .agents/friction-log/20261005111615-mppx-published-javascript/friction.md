---
title: "mppx published JavaScript references absent source maps"
severity: "minor"
target: "mppx"
---

When Vitest inlines mppx 0.12.0 to exercise the actual SDK against mocked viem RPC/signing boundaries, Vite emits ENOENT warnings for dist/\*.js.map referenced by sourceMappingURL comments. The JavaScript is present and tests pass, but missing source maps add substantial noise. Reproduce with test.server.deps.inline=["mppx"] and import mppx/client. Publish the referenced maps or remove their comments.
