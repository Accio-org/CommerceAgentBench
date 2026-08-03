# CLI Daemon Isolation Helper

`server.mjs` is a generic local daemon for high-integrity CLI mocks.

The agent-visible command stays a normal binary name such as `stripe`, but the
public wrapper only forwards argv/stdin/cwd to `POST /__cli/exec`. The daemon
runs as `mocksvc`, owns the real mock source and SQLite state, and exposes
verifier-only `GET /__bench/state` / `GET /__bench/audit`.

This helper is intentionally generic. Individual mocks provide only:

- the hidden target CLI binary path;
- the hidden bench binary path;
- per-mock state environment variables;
- the task seed/reset logic.

By default the daemon invokes bench binaries with `--token <token>` for
backward compatibility. Mocks that support `CCB_INTERNAL_BENCH_TOKEN` can set
`CCB_CLI_BENCH_TOKEN_MODE=env` to keep the verifier token out of child-process
argv.
