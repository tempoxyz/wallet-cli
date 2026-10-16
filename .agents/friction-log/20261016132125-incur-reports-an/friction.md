---
title: "incur reports an unknown flag as UNKNOWN with exit 1, and options cannot be hidden"
severity: "minor"
target: "incur"
---

## Expected Behavior

A flag a command does not take fails as a usage error a CLI can type and explain: a stable code such as `VALIDATION_ERROR` with the flag in `fieldErrors`, or a hook to replace the message, so a removed or moved flag (`--mach` on a command that no longer takes it) can name what replaces it.

## Current Behavior

`Parser.parse` throws `Unknown flag: --mach`, which reaches the caller as `{ code: "UNKNOWN", message: "Unknown flag: --mach" }` with exit code 1, the same code as an unexpected crash. Options have no `hidden` marker, so a command cannot keep accepting a flag only to reject it with a targeted message. To give one, `tempo wallet` strips the flag from argv before `cli.serve` and returns the error from middleware, which runs before the command parses its options.

## Possible Solution

Report unknown flags as a typed usage error (code and exit code distinct from `UNKNOWN`), and accept `.meta({ hidden: true })` on an option so it is parsed but left out of help, `--schema`, MCP input schemas, and `--llms`.

## Minimal Reproducible Example

```ts
import { Cli, z } from "incur";

await Cli.create("probe")
  .command("send", { options: z.object({ yes: z.boolean().optional() }), run: () => ({}) })
  .serve(["send", "--mach", "--format", "json"]);
// { "code": "UNKNOWN", "message": "Unknown flag: --mach" }, exit 1
```

## Context

Hit while adding `tempo wallet send` and pointing `send --mach` and `send --credits` at `transfer --mach` and `transfer --credits` with a typed `E_USAGE` and a `cta`.
