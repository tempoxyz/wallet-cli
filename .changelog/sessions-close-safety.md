---
wallet-cli: patch
---

`tempo wallet sessions close` no longer removes a local session record unless the escrow on the session's own chain reports the channel finalized. A channel ID or URL whose sessions are on another network is refused with `E_USAGE` before any on-chain call, naming that network and the command to rerun with its `--network`, and a channel the escrow does not hold is reported as `not_found` (counted as failed) with its record kept instead of as `closed`.

`sessions close --finalize <target>` withdraws only the target's channels instead of every finalizable channel on the network, and `--finalize` never requests a close: a target whose close was not requested is reported as an error, and one still in its grace period as pending. A pending close's `instruction` names the `--cooperative` command that closes it now through its server, and the command help describes close as a request followed by a withdrawal after the grace period.
