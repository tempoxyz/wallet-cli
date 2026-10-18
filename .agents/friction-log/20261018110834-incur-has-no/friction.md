---
title: "incur has no hook to render a command's result for a person on a terminal"
severity: "minor"
target: "incur"
---

## Expected Behavior

A CLI can render a command's result for a person on a terminal (`human`, which incur sets when stdout is a TTY and no `--format` or `--json` is given) while agents keep the TOON or JSON envelope. For example a `render` option on `Cli.create` or a command, called with the result data, the command's `output` schema, and the `cta`, plus a matching hook for errors that writes them to stderr. Agent output, `--format`, `--full-output`, `--filter-output`, `--token-*`, MCP, and `--llms` would not change.

## Current Behavior

incur 0.7.1 prints the same TOON an agent gets on a terminal, and a human-mode error as `Error (CODE): message` plus a `Suggested commands:` block on stdout. A command `format` only picks one of incur's formats; `outputPolicy: 'agent-only'` only suppresses the data, and still prints the cta and errors itself; middleware cannot see the result. To render its own view, `tempo wallet` decides a human run itself (`humanRun` in `src/cli/incur-compat.ts`), creates the CLI with `format: "json"` for that run, serves `--full-output` with `serve(argv, { stdout, exit })` capturing incur's writes and exit code, parses the envelope, and renders it (`serveHuman`). Usage errors with help and parse errors bypass the envelope and are passed through as incur wrote them.

## Possible Solution

Accept `render?: { result(data, { output, cta, command }): string; error(error, { cta, command }): string }` on `Cli.create` (and optionally per command), used when `human && !formatExplicit && !fullOutput`, with errors written to stderr. Keep the exit code handling as it is.

## Minimal Reproducible Example

```ts
import { Cli, z } from "incur";

// On a terminal this prints `amount: "5.89"` and `symbol: pathUSD` as TOON; there is no way to
// print `Balance  5.89 pathUSD` instead without capturing incur's stdout.
await Cli.create("probe")
  .command("balance", {
    output: z.object({ amount: z.string(), symbol: z.string() }),
    run: () => ({ amount: "5.89", symbol: "pathUSD" }),
  })
  .serve(["balance"]);
```

## Context

Hit while adding human-readable terminal output to `tempo wallet`. Display hints live in a zod registry (`displayMeta` in `src/cli/render.ts`) rather than `.meta()`, because incur copies every `.meta()` key into the JSON Schema of `--schema`, `--llms-full`, and MCP tools.
