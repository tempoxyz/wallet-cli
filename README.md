# wallet-cli

TypeScript/Incur implementation of the Tempo wallet CLI, built on the released `accounts` SDK.

## Development

```sh
pnpm install
pnpm dev -- --help
```

The CLI stores local wallet state in `~/.tempo/wallet/store.json`, matching the accounts SDK-oriented store shape used by this project.

## Checks

Use the aggregate check before shipping changes:

```sh
pnpm check
```

It runs:

- `pnpm check:types` — production TypeScript build typecheck
- `pnpm test:types` — test/helper TypeScript typecheck
- `pnpm test` — Vitest command/unit coverage

Useful individual commands:

```sh
pnpm test
pnpm build
pnpm bundle
pnpm package
```

## Test strategy

Tests live under `test/` and use isolated temporary `HOME` directories so they do not mutate a developer's real wallet state.

Current coverage focuses on command behavior that can run deterministically without a live wallet service:

- identity and store behavior
- token and credits transfer dry-run/error paths
- MPP challenge parsing/error paths
- funding URL/action/error behavior
- service directory normalization/search/detail with mocked `fetch`
- session dry-run/local behavior
- compatibility completions output

Live wallet/payment flows are exercised manually or by higher-level release validation when funded wallets and service fixtures are available.
