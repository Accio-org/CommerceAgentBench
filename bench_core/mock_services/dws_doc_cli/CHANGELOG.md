# Changelog - dws_doc_cli

All notable changes to this mock service. Format follows Keep a Changelog 1.1.0 and Semantic Versioning 2.0.0.

## [Unreleased]

### Added
- `dws doc export` now persists an export record into a new `exports` table (and the dumped
  state's top-level `exports` array) so verifiers can assert that an export actually ran.
  Previously the command returned a path without leaving any trace in state. (2026-06-10)

## [1.0.0] - 2026-06-02

### Added
- Initial DingTalk Workspace CLI doc mock exposing the command name `dws`.
- Doc product coverage for search, list, info, read, create, update, upload, download, copy, move, rename, file/folder creation, block editing, and comments.
- Basic CLI support commands for schema discovery, skill setup, upgrade status, and local mock state controls.
- Ditto-compatible health and verifier endpoints: `/health`, `/api/state`, `/api/sessions`, `/api/access-log`, and `/api/verify`.
- Bun/Node compatible `bin/dws` wrapper for benchmark runtime portability.

[Unreleased]: ../../compare/dws_doc_cli-v1.0.0...HEAD
[1.0.0]: ../../releases/tag/dws_doc_cli-v1.0.0
