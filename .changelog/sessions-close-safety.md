---
wallet-cli: patch
---

`tempo wallet sessions close` no longer removes a local session record unless the session's own chain shows the channel closed: the escrow reports it finalized, or for a v2 session the channel precompile logged its `ChannelClosed` event. A channel ID or URL whose sessions are on another network is refused with `E_USAGE` before any on-chain call, naming that network and the command to rerun with its `--network`, and a channel the escrow does not hold is reported as `not_found` (counted as failed) with its record kept instead of as `closed`. The exception is a v2 session whose close was already requested: the channel precompile clears a closed channel, so its cleared state removes the record and reports `closed` even when the `ChannelClosed` event is past the log scan.

A `--cooperative` close the server accepted but the chain does not show yet is reported as `requested` (counted as pending) and keeps its record, including a v2 session's descriptor, marked `closing` so a later payment to the service opens a new channel instead of reusing this one; its `_next` reruns a plain `sessions close`, which removes the record once the close is on-chain.

`sessions close --finalize <target>` withdraws only the target's channels instead of every finalizable channel on the network, and `--finalize` never requests a close: a target whose close was not requested is reported as an error, and one still in its grace period as pending. A pending close's `instruction` names the `--cooperative` command that closes it now through its server for v1 sessions, and the command help describes close as a request followed by a withdrawal after the grace period.
