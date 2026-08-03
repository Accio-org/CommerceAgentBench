#!/usr/bin/env bash
# Build the derived workstation image that bundles the shopify_admin mock site
# at /opt/mock_services/shopify_admin/. The base must be the office derived
# image (linux or mac). Original *-auth and *-auth-office images are NOT modified.
#
# Usage:
#   scripts/build_shopify_admin_image.sh                  # linux variant (default)
#   scripts/build_shopify_admin_image.sh linux
#   scripts/build_shopify_admin_image.sh mac
#   scripts/build_shopify_admin_image.sh openclaw          # one-shot build: domain_v1 mocks from
#                                                          # openclaw base (no intermediate image).
#   scripts/build_shopify_admin_image.sh subagent-inherit  # bake shopify_admin on top of the
#                                                          # publish-subagent-inherit base so the
#                                                          # final image carries alibaba_publish +
#                                                          # reddit_mock + shopify_admin together
#                                                          # (the "all mocks" tag).
#   scripts/build_shopify_admin_image.sh all
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE_LINUX_IMAGE="${BASE_LINUX_IMAGE:-accio/workstation:v2-vp1080-linux-auth-office}"
BASE_MAC_IMAGE="${BASE_MAC_IMAGE:-accio/workstation:v2-vp1080-mac-auth-office}"
BASE_OPENCLAW_IMAGE="${BASE_OPENCLAW_IMAGE:-acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859}"
BASE_SUBAGENT_INHERIT_IMAGE="${BASE_SUBAGENT_INHERIT_IMAGE:-accio/workstation:v2-vp1080-linux-auth-office-publish-subagent-inherit}"
LINUX_TARGET_IMAGE="${LINUX_TARGET_IMAGE:-accio/workstation:v2-vp1080-linux-auth-office-shopify-admin}"
MAC_TARGET_IMAGE="${MAC_TARGET_IMAGE:-accio/workstation:v2-vp1080-mac-auth-office-shopify-admin}"
OPENCLAW_ALL_MOCKS_IMAGE="${OPENCLAW_ALL_MOCKS_IMAGE:-realreplicabench/openclaw:local-mocks}"
SUBAGENT_INHERIT_TARGET_IMAGE="${SUBAGENT_INHERIT_TARGET_IMAGE:-accio/workstation:v2-vp1080-linux-auth-office-publish-subagent-inherit-shopify-admin}"
TARGET="${1:-linux}"

DOCKERFILE="${PROJECT_ROOT}/docker/shopify-admin-mock/Dockerfile"
BUILD_CONTEXT="${PROJECT_ROOT}/build/shopify-admin-mock-context"

prepare_context() {
  rm -rf "${BUILD_CONTEXT}"
  mkdir -p "${BUILD_CONTEXT}"
  rsync -a --delete \
    --exclude '__pycache__/' \
    --exclude '.DS_Store' \
    --exclude 'data/' \
    --exclude 'uploads/' \
    --exclude 'node_modules/' \
    "${PROJECT_ROOT}/real_replica_bench/mock_services/shopify_admin/" \
    "${BUILD_CONTEXT}/shopify_admin/"
  cp "${DOCKERFILE}" "${BUILD_CONTEXT}/Dockerfile"
}

build_one() {
  local base_image="$1"
  local target_image="$2"
  docker image inspect "${base_image}" >/dev/null
  docker build \
    --platform linux/amd64 \
    --build-arg "BASE_IMAGE=${base_image}" \
    -t "${target_image}" \
      "${BUILD_CONTEXT}"
}

rsync_openclaw_mock() {
  local source="$1"
  local target="$2"
  shift 2
  rsync -a --delete \
    --exclude '__pycache__/' \
    --exclude '.DS_Store' \
    --exclude 'node_modules/' \
    "$@" \
    "${PROJECT_ROOT}/real_replica_bench/mock_services/${source}/" \
    "${target}"
}

prepare_openclaw_all_mocks_context() {
  local ctx="$1"
  local dockerfile="$2"
  rm -rf "${ctx}"
  mkdir -p "${ctx}"

  rsync_openclaw_mock alibaba_publish "${ctx}/alibaba_publish/" \
    --exclude 'data/' --exclude 'uploads/'
  rsync_openclaw_mock reddit_mock "${ctx}/reddit_mock/"
  rsync_openclaw_mock shopify_admin "${ctx}/shopify_admin/" \
    --exclude 'data/' --exclude 'uploads/'

  rsync_openclaw_mock gmail_mock "${ctx}/gmail_mock/" \
    --exclude 'data/'
  rsync_openclaw_mock amazon_sp_api "${ctx}/amazon_sp_api/"
  rsync_openclaw_mock google_docs_mock "${ctx}/google_docs_mock/" \
    --exclude 'data/state.json' --exclude '.tmp/'
  rsync_openclaw_mock notion_cli "${ctx}/notion_cli/" \
    --exclude 'data/' --exclude 'golden/' --exclude 'test/'
  rsync_openclaw_mock shopify_online_store_v2 "${ctx}/shopify_online_store_v2/" \
    --exclude 'data/' --exclude 'screenshots/' --exclude 'golden/' --exclude 'golden_real_cli/'

  rsync_openclaw_mock cli_daemon "${ctx}/cli_daemon/"
  for cli_mock in stripe_cli box_cli jira_cli todoist_cli dws_doc_cli google_workspace_cli; do
    rsync_openclaw_mock "${cli_mock}" "${ctx}/${cli_mock}/" \
      --exclude 'data/'
  done

  cp "${dockerfile}" "${ctx}/Dockerfile"
}

case "${TARGET}" in
  linux)
    prepare_context
    build_one "${BASE_LINUX_IMAGE}" "${LINUX_TARGET_IMAGE}"
    echo "linux_shopify_admin_image=${LINUX_TARGET_IMAGE}"
    ;;
  mac)
    prepare_context
    build_one "${BASE_MAC_IMAGE}" "${MAC_TARGET_IMAGE}"
    echo "mac_shopify_admin_image=${MAC_TARGET_IMAGE}"
    ;;
  openclaw)
    # One-shot build: installs the domain_v1 mock suite on the OpenClaw base
    # in a single image layer, with no intermediate *-publish tag. Uses a
    # dedicated combined Dockerfile at docker/openclaw/Dockerfile.all-mocks.
    OPENCLAW_DOCKERFILE="${PROJECT_ROOT}/docker/openclaw/Dockerfile.all-mocks"
    OPENCLAW_BUILD_CONTEXT="${PROJECT_ROOT}/build/openclaw-all-mocks-context"
    prepare_openclaw_all_mocks_context "${OPENCLAW_BUILD_CONTEXT}" "${OPENCLAW_DOCKERFILE}"
    docker image inspect "${BASE_OPENCLAW_IMAGE}" >/dev/null
    docker build \
      --platform linux/amd64 \
      --build-arg "BASE_IMAGE=${BASE_OPENCLAW_IMAGE}" \
      -t "${OPENCLAW_ALL_MOCKS_IMAGE}" \
      "${OPENCLAW_BUILD_CONTEXT}"
    echo "openclaw_all_mocks_image=${OPENCLAW_ALL_MOCKS_IMAGE}"
    ;;
  subagent-inherit)
    # Stack shopify_admin on top of the publish-subagent-inherit base. The
    # base already carries alibaba_publish + reddit_mock + the subagent
    # inheritance layer; this target adds the third mock so a single image
    # covers all bundled mock services.
    prepare_context
    build_one "${BASE_SUBAGENT_INHERIT_IMAGE}" "${SUBAGENT_INHERIT_TARGET_IMAGE}"
    echo "subagent_inherit_shopify_admin_image=${SUBAGENT_INHERIT_TARGET_IMAGE}"
    ;;
  openclaw-v2026.5.22)
    # Legacy two-stage migration build retained for historical development;
    # this is not the v1.3.1 release-image lineage. OpenClaw v2026.5.22
    # fundamentally rewrote the browser stack
    # (chrome-relay extension → driver=openclaw + attachOnly=true via
    # managed CDP), so the base image is built from a separate
    # Dockerfile.v2026.5.22 that upgrades the npm package and skips the
    # extension copy/patch.
    #   stage 1 → commercecraftbench/openclaw:ccb-2026.5.22
    #   stage 2 → commercecraftbench/openclaw:ccb-2026.5.22-publish-domain-v1.2
    BASE_V2_IMAGE="${BASE_V2_IMAGE:-commercecraftbench/openclaw:ccb-2026.5.22}"
    V2_ALL_MOCKS_IMAGE="${V2_ALL_MOCKS_IMAGE:-commercecraftbench/openclaw:ccb-2026.5.22-publish-domain-v1.2}"
    # Start from our existing v1.3 derived image (commercecraftbench/
    # Legacy March image migration path; the public v1.3.1 release uses the
    # separately pinned May 2026 OpenClaw runtime documented in README.md.
    # copy + patched extension). Dockerfile.v2026.5.22 will overwrite the
    # npm openclaw package to 2026.5.22 and re-install bun (idempotent —
    # install -m 0755 overwrites the existing symlink/binary at
    # /usr/local/bin/bun). The chrome-extension copy stays in the image
    # but is dead weight (cli.py + Dockerfile.all-mocks no longer
    # reference it under v2026.5.22 mode).
    CCB_V1_3_BASE="${CCB_V1_3_BASE:-commercecraftbench/openclaw:ccb-v1.3}"
    docker image inspect "${CCB_V1_3_BASE}" >/dev/null
    # stage 1: install OpenClaw 2026.5.22 + bun on top of our v1.3 derived base
    docker build \
      --platform linux/amd64 \
      --build-arg "BASE_IMAGE=${CCB_V1_3_BASE}" \
      -t "${BASE_V2_IMAGE}" \
      -f "${PROJECT_ROOT}/docker/openclaw/Dockerfile.v2026.5.22" \
      "${PROJECT_ROOT}/docker/openclaw"
    echo "openclaw_v2_base_image=${BASE_V2_IMAGE}"
    # stage 2: bake the domain_v1 mock suite + media-root + mocksvc isolation
    OPENCLAW_BUILD_CONTEXT="${PROJECT_ROOT}/build/openclaw-all-mocks-context-v2"
    prepare_openclaw_all_mocks_context "${OPENCLAW_BUILD_CONTEXT}" "${PROJECT_ROOT}/docker/openclaw/Dockerfile.all-mocks"
    docker build \
      --platform linux/amd64 \
      --build-arg "BASE_IMAGE=${BASE_V2_IMAGE}" \
      -t "${V2_ALL_MOCKS_IMAGE}" \
      "${OPENCLAW_BUILD_CONTEXT}"
    echo "openclaw_v2_all_mocks_image=${V2_ALL_MOCKS_IMAGE}"
    ;;
  all)
    prepare_context
    build_one "${BASE_LINUX_IMAGE}" "${LINUX_TARGET_IMAGE}"
    echo "linux_shopify_admin_image=${LINUX_TARGET_IMAGE}"
    build_one "${BASE_MAC_IMAGE}" "${MAC_TARGET_IMAGE}"
    echo "mac_shopify_admin_image=${MAC_TARGET_IMAGE}"
    ;;
  *)
    echo "usage: $0 [linux|mac|openclaw|openclaw-v2026.5.22|subagent-inherit|all]" >&2
    exit 2
    ;;
esac
