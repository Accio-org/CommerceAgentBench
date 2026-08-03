#!/usr/bin/env bash
set -euo pipefail

# Fetch or import the OpenClaw runtime image used by the release harness.
#
# Default mode pulls the public all-mocks image from Docker Hub:
#   scripts/import_openclaw_image.sh
#
# Offline handoff mode accepts a local docker-save tarball:
#   OPENCLAW_IMPORT_SOURCE=tarball TARBALL_PATH=/path/to/openclaw.tar.gz scripts/import_openclaw_image.sh

OPENCLAW_IMPORT_SOURCE="${OPENCLAW_IMPORT_SOURCE:-dockerhub}"
OPENCLAW_RELEASE_IMAGE="${OPENCLAW_RELEASE_IMAGE:-acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859}"
OPENCLAW_LOCAL_TAG="${OPENCLAW_LOCAL_TAG:-realreplicabench/openclaw:v1.3.1}"

# --- Optional local tarball path -----------------------------------------
TARBALL_PATH="${TARBALL_PATH:-}"

die() {
  echo "import_openclaw_image.sh: ERROR: $*" >&2
  exit 1
}

pull_from_dockerhub() {
  docker pull --platform linux/amd64 "${OPENCLAW_RELEASE_IMAGE}"
  docker tag "${OPENCLAW_RELEASE_IMAGE}" "${OPENCLAW_LOCAL_TAG}"
  echo "release_image=${OPENCLAW_RELEASE_IMAGE}"
  echo "local_tag=${OPENCLAW_LOCAL_TAG}"
}

load_from_local_tarball() {
  [[ -n "${TARBALL_PATH}" ]] || die "TARBALL_PATH is required when OPENCLAW_IMPORT_SOURCE=tarball"
  [[ -s "${TARBALL_PATH}" ]] || die "tarball not found or empty: ${TARBALL_PATH}"

  local load_output loaded_tag
  load_output="$(docker load -i "${TARBALL_PATH}" 2>&1 | tee /dev/stderr | tail -20)"
  loaded_tag="$(
    printf '%s\n' "${load_output}" \
      | sed -n 's/^Loaded image: //p' \
      | tail -1
  )"
  [[ -n "${loaded_tag}" ]] || die "could not parse loaded image tag from docker load output"

  if [[ "${loaded_tag}" != "${OPENCLAW_LOCAL_TAG}" ]]; then
    docker tag "${loaded_tag}" "${OPENCLAW_LOCAL_TAG}"
  fi

  echo "loaded_image=${loaded_tag}"
  echo "local_tag=${OPENCLAW_LOCAL_TAG}"
}

case "${OPENCLAW_IMPORT_SOURCE}" in
  dockerhub|docker|pull)
    pull_from_dockerhub
    ;;
  tar|tarball|local-tarball)
    load_from_local_tarball
    ;;
  *)
    die "unknown OPENCLAW_IMPORT_SOURCE=${OPENCLAW_IMPORT_SOURCE}; use dockerhub or tarball"
    ;;
esac
