---
tempo-request: patch
---

Fixed payment intent negotiation before the initial request. Explicit charge and session intents now send `Accept-Payment`, and MACH requests prefer charges automatically, so session-default services can offer MACH-enabled charges without a manual header. Explicit `Accept-Payment` headers remain unchanged.
