---
title: "incur group roots skip tokens that look like a subcommand typo, including ids and bound flags"
severity: "minor"
target: "incur"
---

## Expected Behavior

A group with a root command and positional args runs the root for any token that names no subcommand, so `services edgar-search` passes `edgar-search` to the root's `serviceId` arg, as it would without subcommands.

## Current Behavior

`resolveCommand` falls back to the group root only when `suggest(token, subcommands)` finds nothing. Any token incur takes for a typo of a subcommand is reported as an unknown command instead: with subcommands `list`, `search`, and `show`, the ids `edgar-search`, `research`, `aisa`, and `s`, and option tokens such as `--search=ai` (after binding `--search ai`), all fail, while `weather` and `--search=image generation` reach the root. The check also runs on flags, so whether `--search <query>` works depends on the query's length.

## Possible Solution

Skip the typo check when the group has a root whose args can take the token, or at least for tokens that start with `-`.

## Minimal Reproducible Example

```ts
const services = Cli.create("services", {
  args: z.object({ serviceId: z.string().optional() }),
  run: ({ args }) => ({ serviceId: args.serviceId }),
})
  .command("list", { run: () => [] })
  .command("search", { args: z.object({ query: z.string() }), run: () => [] });
Cli.create("tool").command(services).serve(["services", "edgar-search"]);
// Fails as an unknown command that suggests `search`; the root never runs.
```

## Context

Hit while adding `tempo wallet services list|search|show` and keeping `services <id>` and `services --search <query>` as deprecated forms. Two real directory ids (`aisa`, `edgar-search`) would have broken, so `normalizeServicesArgs` in `src/cli/argv.ts` rewrites the deprecated forms to the subcommands before incur sees them.
