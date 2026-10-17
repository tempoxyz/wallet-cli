---
title: "incur has no deprecated or hidden command marker, and command aliases resolve only within their own group"
severity: "minor"
target: "incur"
---

## Expected Behavior

A command moved into a group, such as `revoke` into `keys revoke`, can keep its old top-level name as an alias of the new command, marked deprecated: help lists it as deprecated or hides it, a human run prints a deprecation notice, and MCP and `--llms` describe it as deprecated, the way an option's `.meta({ deprecated: true })` already works.

## Current Behavior

A command's `aliases` map an alternative name to a command in the same group only, so a top-level name cannot point at `keys revoke`. Commands have no `deprecated` or `hidden` field. Each deprecated name is a separate command that copies the definition with a "Deprecated: use ..." description and writes its own notice, as `src/commands/debug.ts` and `src/commands/revoke.ts` do.

## Possible Solution

Accept `deprecated: true | string` and `hidden: true` on a command definition, emitting the notice on human runs and marking the MCP tool description, and let `aliases` name a command path in another group.

## Minimal Reproducible Example

```ts
const keys = Cli.create("keys").command("revoke", { aliases: ["revoke"], run: () => ({}) });
// `revoke` resolves only as `keys revoke`; there is no way to mount it at the root as a
// deprecated alias of `keys revoke`.
Cli.create("tempo wallet").command(keys);
```

## Context

Hit while moving `tempo wallet revoke` to `tempo wallet keys revoke` and keeping `revoke` as a deprecated alias.
