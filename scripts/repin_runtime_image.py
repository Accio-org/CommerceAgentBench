#!/usr/bin/env python3
"""Repin the RealReplicaBench runtime image digest across the repository.

The runtime image is pinned by digest, not by tag, because the human-readable
Docker Hub tag is mutable. That pin appears in ~150 places, so rebuilding the
image means rewriting all of them together — a partial rewrite silently splits
the suite across two runtimes.

Not every occurrence of the digest is a live pin, though. Some record which
image a published result was *measured on*, or which image a build recipe
starts *from*. Rewriting those would be a lie: it would attribute old results
to a runtime that never produced them. So this script rewrites
only the paths that decide what actually runs, and reports every other
occurrence for a human to judge.

Typical use, after building and pushing a new image::

    # what would change, and what is left for review
    python scripts/repin_runtime_image.py --new-digest sha256:<new> --dry-run

    # do it
    python scripts/repin_runtime_image.py --new-digest sha256:<new>

The old digest defaults to whatever is currently pinned in
``datasets_domain_v1/cli/box/supplier-docroom-audit/task.toml``; pass
``--old-digest`` to override.
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# A task manifest that is guaranteed to carry the pin, used to auto-detect the
# digest currently in force.
REFERENCE_MANIFEST = "datasets_domain_v1/cli/box/supplier-docroom-audit/task.toml"

DIGEST_RE = re.compile(r"\bsha256:[0-9a-f]{64}\b")

# Paths whose digest decides what actually runs. Only these are rewritten.
LIVE_PIN_GLOBS = (
    "datasets_domain_v1/**/task.toml",                    # base_images
    "datasets_domain_v1/**/services/start_services.sh",   # expected-image check
    "configs/*.yaml",                                     # image:
    "real_replica_bench/constants.py",                    # canonical constant
    "real_replica_bench/mock_services/registry.py",
    "scripts/import_openclaw_image.sh",                   # pulls the release image
    "scripts/validate_release.py",                        # asserts the current pin
    "tests/test_public_api.py",                           # asserts the current pin
    # Prose that states the current release runtime rather than recording a
    # historical one. A reader copying from either expects what the suite runs.
    "datasets_domain_v1/README.md",
    "real_replica_bench/harnesses/openclaw/README.md",
)

# Why a non-live occurrence is left alone. Longest matching prefix wins.
FROZEN_REASONS = {
    "results/": (
        "provenance — records the runtime the published results were measured "
        "on. Rewriting it would attribute old scores to a new image."
    ),
    "docker/openclaw/": (
        "build base — decide per rebuild whether the variant should rebase "
        "onto the new runtime."
    ),
    "scripts/build_shopify_admin_image.sh": (
        "build base — decide per rebuild whether the variant should rebase."
    ),
    "README.md": (
        "mixed — the quickstart commands track the current image, but the "
        "reproducibility table is a per-release record."
    ),
    "docs/": (
        "mixed — release-identity tables are historical; pull/build commands "
        "track the current image."
    ),
    "THIRD_PARTY_NOTICES.md": "release attribution — update deliberately.",
}

SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
    ".tar", ".whl", ".pyc", ".so", ".dylib", ".woff", ".woff2", ".ttf",
}


def _git_tracked_files(root: Path) -> list[Path] | None:
    """Tracked (and new, non-ignored) files per git, or None without git.

    Gitignored paths — the local-only site workspaces and the legacy
    ``docs/index.html`` page — carry stale copies of the digest on purpose and
    must not be rewritten.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z",
             "--cached", "--others", "--exclude-standard"],
            capture_output=True, check=True, text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return [root / name for name in out.split("\0") if name]


def iter_candidate_files(root: Path):
    """Yield every tracked text file that could carry the pin."""
    tracked = _git_tracked_files(root)
    paths = tracked if tracked is not None else sorted(root.rglob("*"))
    for path in paths:
        if not path.is_file() or path.is_symlink():
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        yield path


def _match_recursive(rel: str, pat: str) -> bool:
    """Match a ``**/`` glob against a path of any depth."""
    head, _, tail = pat.partition("**/")
    if not rel.startswith(head):
        return False
    parts = rel[len(head):].split("/")
    return any(
        fnmatch.fnmatch("/".join(parts[i:]), tail) for i in range(len(parts))
    )


def is_live_pin(rel: str) -> bool:
    for pat in LIVE_PIN_GLOBS:
        if "**/" in pat:
            if _match_recursive(rel, pat):
                return True
        elif fnmatch.fnmatch(rel, pat):
            return True
    return False


def frozen_reason(rel: str) -> str:
    best, out = "", "not a known live pin"
    for prefix, reason in FROZEN_REASONS.items():
        if rel.startswith(prefix) and len(prefix) > len(best):
            best, out = prefix, reason
    return out


def detect_current_digest(root: Path) -> str:
    ref = root / REFERENCE_MANIFEST
    if not ref.is_file():
        sys.exit(
            f"cannot auto-detect the current digest: {REFERENCE_MANIFEST} is "
            f"missing. Pass --old-digest explicitly."
        )
    found = DIGEST_RE.findall(ref.read_text(encoding="utf-8"))
    if not found:
        sys.exit(
            f"cannot auto-detect the current digest: no sha256 pin in "
            f"{REFERENCE_MANIFEST}. Pass --old-digest explicitly."
        )
    if len(set(found)) > 1:
        sys.exit(
            f"{REFERENCE_MANIFEST} pins more than one digest "
            f"{sorted(set(found))}; pass --old-digest to disambiguate."
        )
    return found[0]


def normalise_digest(value: str, flag: str) -> str:
    digest = value if value.startswith("sha256:") else f"sha256:{value}"
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        sys.exit(
            f"{flag}: expected a sha256 digest with 64 lowercase hex chars, "
            f"got {value!r}"
        )
    return digest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repin the runtime image digest across the repository.",
    )
    parser.add_argument(
        "--new-digest", required=True,
        help="digest to pin, e.g. sha256:abc... ('sha256:' prefix optional)",
    )
    parser.add_argument(
        "--old-digest",
        help="digest to replace (default: auto-detected from the task manifests)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args()

    new_digest = normalise_digest(args.new_digest, "--new-digest")
    old_digest = (
        normalise_digest(args.old_digest, "--old-digest")
        if args.old_digest else detect_current_digest(REPO_ROOT)
    )

    if old_digest == new_digest:
        print(f"already pinned to {new_digest} — nothing to do")
        return 0

    print(f"old: {old_digest}")
    print(f"new: {new_digest}\n")

    changed: list[tuple[str, int]] = []
    review: list[tuple[str, int, str]] = []

    for path in iter_candidate_files(REPO_ROOT):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hits = text.count(old_digest)
        if not hits:
            continue
        rel = str(path.relative_to(REPO_ROOT))

        if not is_live_pin(rel):
            review.append((rel, hits, frozen_reason(rel)))
            continue

        changed.append((rel, hits))
        if not args.dry_run:
            path.write_text(text.replace(old_digest, new_digest), encoding="utf-8")

    if not changed and not review:
        print(f"no file carries {old_digest} — nothing to do")
        return 0

    by_area: dict[str, int] = {}
    for rel, _ in changed:
        by_area[rel.split("/")[0]] = by_area.get(rel.split("/")[0], 0) + 1
    verb = "would rewrite" if args.dry_run else "rewrote"
    print(f"{verb} {len(changed)} files "
          f"({sum(h for _, h in changed)} occurrences):")
    for area, count in sorted(by_area.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}  {area}")

    if review:
        print(f"\nLEFT ALONE — {len(review)} files "
              f"({sum(h for _, h, _ in review)} occurrences) need a human call:")
        seen: set[str] = set()
        for rel, hits, reason in review:
            print(f"  {rel} ({hits}x)")
            if reason not in seen:
                seen.add(reason)
                print(f"      {reason}")

    if args.dry_run:
        print("\ndry run — nothing written. Re-run without --dry-run to apply.")
        return 0

    # A stale pin left in a live-pin path means the suite straddles two runtimes.
    leftover = [
        str(p.relative_to(REPO_ROOT))
        for p in iter_candidate_files(REPO_ROOT)
        if is_live_pin(str(p.relative_to(REPO_ROOT))) and _contains(p, old_digest)
    ]
    if leftover:
        print(f"\nWARNING: {old_digest} still present in live-pin paths:")
        for item in leftover[:20]:
            print(f"  {item}")
        return 1
    print(f"\nverified: no live pin still references {old_digest}")
    return 0


def _contains(path: Path, needle: str) -> bool:
    try:
        return needle in path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False


if __name__ == "__main__":
    raise SystemExit(main())
