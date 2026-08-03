# stripe_cli mock — changelog

## 2026-06-13 — `--metadata` greedy varargs parity with real stripe-cli

`--metadata` now consumes **all** subsequent `key=value` tokens until the
next `-`/`--` flag or end-of-argv, matching real stripe-cli behavior.
Previously the parser only swallowed one token, so
`stripe customers create … --metadata priority=A region=us total=12345`
silently dropped `region` and `total` — they fell through as positional
arguments that the mock then ignored.

Bug surfaced in the 2026-06-12 GPT-5.5 release on
`cli-xfer-customs-trade-finance-pipeline` (triage case 93 / #54): all 12
qualified customers ended up with `metadata={priority:"A"}` only, missing
`region` and `total_amount` that the policy required.

Multiple `--metadata` blocks still merge correctly; greedy consumption
stops at the next flag so adjacent commands like
`--metadata k=v --name foo` parse unchanged.

File: `lib/dispatch.js` (the `--metadata` branch of `parseArgs`).
