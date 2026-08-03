# Security Policy

## Supported release

Security fixes are accepted for the current `v1.3.x` release line.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow from the repository's
**Security** tab. Do not open a public issue for:

- credentials or private data found in tracked files or artifacts;
- a way for an evaluated agent to read graders, private seeds, verifier tokens,
  or mock source;
- a mock-service write or verifier-state bypass;
- container escape, privilege escalation, or cross-run state leakage; or
- result tampering that can produce an invalid passing score.

Include the affected commit, task ID, runtime digest, minimal reproduction, and
impact. Do not include real production credentials or customer data.

## Evaluation credentials

Treat every evaluated model as untrusted code. The agent has shell access in
its task container, and provider credentials must be present in that runtime
long enough to make model calls. Use dedicated, least-privilege evaluation
keys with spend and rate limits. Do not grant them access to production
resources, and rotate or revoke them after use.

Benchmark-quality bugs that do not expose a security or integrity boundary can
be filed as ordinary issues.
