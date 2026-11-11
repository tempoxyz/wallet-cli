---
tempo-request: patch
---

`tempo request` sends every value of a header given more than once with `-H`, as curl does, instead of keeping only the last one. The first `-H` for a name still replaces the default, such as `User-Agent`.
