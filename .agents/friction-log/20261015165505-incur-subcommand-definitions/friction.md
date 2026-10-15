---
title: "incur subcommand definitions declared outside .command() lose their typed run context"
severity: "minor"
target: "incur"
---

## Expected Behavior

A subcommand definition declared in its own module, then mounted with `cli.command("close", closeCommand)`, gets the same typed `run` context (`args`, `options`, and the group's `globals`) as one written inline in the `.command()` call.

## Current Behavior

incur types `run` only through the contextual type of the `.command()` call. `CommandDefinition` is not exported, and `Cli.command()`/`FileCommand` fix the CLI globals to `undefined`, so `globals.network` does not type-check. Each split-out definition in `src/commands/sessions/` spells out its run context from the schemas (`z.output<typeof cliGlobals>` and so on).

## Possible Solution

Export `CommandDefinition` with its `globals` parameter, or add a helper such as `Cli.command<typeof globals>(definition)` that keeps the globals type.

## Minimal Reproducible Example

```ts
const list = {
  options: z.object({ all: z.boolean().optional() }),
  run({ globals }) {
    // Parameter 'globals' implicitly has an 'any' type.
    return globals.network;
  },
};
Cli.create("sessions", { globals: z.object({ network: z.string().optional() }) }).command(
  "list",
  list,
);
```

## Context

Hit while splitting `tempo wallet sessions` into one module per subcommand.
