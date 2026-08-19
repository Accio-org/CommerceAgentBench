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

## cwd is forwarded conditionally

The wrapper sends the caller's cwd only when **every** component of it carries
the world-execute bit. Otherwise it sends `''` and the daemon falls back to
`/`.

That bit is the one that matters because the daemon spawns the target CLI as
the unprivileged `mocksvc` user. Give it a cwd it cannot traverse and the
spawn fails as a bare `exit 127` with empty stdout *and* empty stderr — from
the caller's side that is indistinguishable from a broken CLI, with nothing to
grep for. An agent shell whose default cwd is `/root` (0700, root-owned) would
hit it on every invocation.

The check is per-component on purpose: a 0777 directory under a 0700 parent is
still untraversable, so testing only the final component would forward a cwd
that cannot work.

This narrows what the wrapper sends and nothing else — uid, permissions,
token handling, and target-binary semantics are unchanged, and directories
that already worked (`/task`, `/tmp`) behave exactly as before. The wrapper
was never a security boundary: the agent runs as root and can bypass it
entirely.

The wrapper is generated as a string literal in
`bench_core/cli.py::_install_runtime_mock_cli_wrappers`, so no type
checker or linter reads it and no other test covers it.
`tests/test_daemon_cli_wrapper_cwd.py` recovers the generated source and
exercises the real function — keep it passing when editing the wrapper.

### Open items on the daemon half

The guarantee above is client-side only. Two things are still outstanding in
`server.mjs`, and both need an all-mocks image rebuild to take effect:

- `safeCwd()` accepts any path that stats as a directory, so a cwd arriving
  from anywhere else is taken at face value. It should be a prefix allowlist
  (`/task`, `/tmp`, `/var/lib/mocksvc`, `/`).
- A spawn that fails because of an unusable cwd should surface real stderr
  instead of a silent `exit 127`, so the cause is visible to the caller rather
  than disguised as a CLI crash.
