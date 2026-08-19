# Accio Work Harness

This harness runs a benchmark task inside a fresh Accio Work / Phoenix workstation container and drives `/opt/agent-memory-test`.

Accio-specific assets stay here so the outer `bench_core` package remains the benchmark framework, not a synonym for the Accio runtime. Future harnesses should follow the same pattern: keep runtime-specific assets and glue under `bench_core/harnesses/<harness_name>/`, while preserving the shared run directory, task, verifier, and report contracts.
