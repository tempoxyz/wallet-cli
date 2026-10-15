# Agent Guidelines

## Layout

- Each `tempo wallet` command, or group such as `keys`, is one module, `src/commands/<command>.ts`. It holds the handler and default-exports the incur command with its `run` wiring, the MCP `annotations` of each tool it serves, and optionally its `--describe` entry. A command without one, like `completions`, is left out of `--describe`.
- Keep annotations on that export, not on the incur command's `mcp`: incur also reads those into `--llms-full` and synced skills.
- Its args, options, and output schemas are in `src/schemas/<command>.ts`, and the globals and shared shapes in `src/schemas/shared.ts`. Import the module you need; there is no barrel.
- `src/cli.ts` imports each command and lists it once. `--describe` follows that list, and shell completions offer the mounted commands in its order, then incur's builtin `mcp` and `skills`. A new command adds one import and one list entry.
- `src/cli/` holds the plumbing: argv preprocessing, the MCP server, the `--describe` builders, incur's builtin `mcp` and `skills`, and the completion scripts.
- Workarounds for upstream bugs live in `src/cli/incur-compat.ts` (incur, including `patches/`) and `src/provider/accounts-compat.ts` (accounts SDK), each with the upstream fix that makes it removable.
- `tempo request` is `src/request-cli.ts` and `src/commands/request.ts`.

## Friction logging

- Log papercuts and friction (tooling, docs, APIs, tests, conventions) as you hit them with `pnpx frog log`.
- Do not add global, system, or internal friction.
- Run `pnpx frog list` first to see what is already known.
