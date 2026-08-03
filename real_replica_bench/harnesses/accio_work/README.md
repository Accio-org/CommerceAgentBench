# Accio Work Harness

This harness runs a benchmark task inside a fresh Accio Work / Phoenix workstation container and drives `/opt/agent-memory-test`.

Accio-specific assets stay here so the outer `real_replica_bench` package remains the benchmark framework, not a synonym for the Accio runtime. Future harnesses should follow the same pattern: keep runtime-specific assets and glue under `real_replica_bench/harnesses/<harness_name>/`, while preserving the shared run directory, task, verifier, and report contracts.
