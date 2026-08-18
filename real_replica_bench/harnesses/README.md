# Harnesses

Commerce Agent Bench keeps the benchmark contract separate from agent runtimes.

- `accio_work/`: Accio Work / Phoenix workstation harness assets and runtime glue.
- `openclaw/`: OpenClaw browser-capable harness assets and runtime glue.

Shared task loading, result layout, report generation, and verifier helpers live in the top-level `real_replica_bench` package.
