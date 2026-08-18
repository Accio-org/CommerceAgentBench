#!/usr/bin/env bash
set -euo pipefail

# Legacy migration helper retained for historical development. It does not
# build the pinned Commerce Agent Bench v1.3.1 runtime. Use
# scripts/import_openclaw_image.sh for the release image.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-commercecraftbench/openclaw:base-v1.3}"
TARGET_IMAGE="${TARGET_IMAGE:-commercecraftbench/openclaw:ccb-v1.3}"

docker image inspect "${BASE_IMAGE}" >/dev/null
PLATFORM="${PLATFORM:-linux/amd64}"
docker build \
  --platform "${PLATFORM}" \
  --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
  -t "${TARGET_IMAGE}" \
  "${PROJECT_ROOT}/docker/openclaw"

echo "openclaw_image=${TARGET_IMAGE}"
