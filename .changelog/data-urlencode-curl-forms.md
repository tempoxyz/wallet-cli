---
tempo-request: patch
---

`tempo request --data-urlencode` accepts curl's `=content`, `@file` and `name@file` forms: `=content` no longer sends a leading `=`, and the file forms send the file's encoded contents instead of the encoded `@path`.
