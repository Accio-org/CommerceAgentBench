# Notion CLI mock — independent golden-output oracle

These golden files are an **independent** oracle for the Notion CLI mock. Their
authority is the **real `ntn` binary** (v0.15.0) — never this mock.

## Derivation

All files captured from the real `ntn` binary installed via `npm install -g ntn`
on 2026-06-01. The binary is a closed-source Rust tool distributed as a
platform-native npm package.

### Capturing

```bash
ntn --version > version.stdout 2>version.stderr; echo $? > version.exit
ntn --help > help.stdout 2>help.stderr; echo $? > help.exit
ntn api --help > api-help.stdout 2>api-help.stderr; echo $? > api-help.exit
ntn workers --help > workers-help.stdout 2>workers-help.stderr; echo $? > workers-help.exit
ntn boguscmd > boguscmd.stdout 2>boguscmd.stderr; echo $? > boguscmd.exit
ntn workers bogus > workers-bogus.stdout 2>workers-bogus.stderr; echo $? > workers-bogus.exit
ntn api v1/users/me > noauth-api.stdout 2>noauth-api.stderr; echo $? > noauth-api.exit
ntn workers list > noauth-workers.stdout 2>noauth-workers.stderr; echo $? > noauth-workers.exit
```

### Fixtures

| fixture | command | exit | notes |
|---------|---------|------|-------|
| `version` | `ntn --version` | 0 | `ntn 0.15.0` |
| `help` | `ntn --help` | 0 | full app help |
| `api-help` | `ntn api --help` | 0 | includes inline syntax docs |
| `workers-help` | `ntn workers --help` | 0 | subcommand list |
| `boguscmd` | `ntn boguscmd` | 2 | `error: unrecognized subcommand 'boguscmd'` |
| `workers-bogus` | `ntn workers bogus` | 2 | `error: unrecognized subcommand 'bogus'` |
| `noauth-api` | `ntn api v1/users/me` | 4 | no workspace selected |
| `noauth-workers` | `ntn workers list` | 4 | no workspace selected |

## Known divergences

The mock uses Commander.js (Node), not Rust/clap. Help format and error
messages will differ structurally (Commander prints `Usage: ntn-mock ...`
vs clap's `Usage: ntn ...`). The `smoke_test.sh` golden section tests
**version output** and **exit codes** for an exact match, but flags help-text
comparison as known divergences (format cannot be byte-identical between
Commander.js and clap).
