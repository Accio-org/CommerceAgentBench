#!/usr/bin/env python3
"""Validate the public Commerce Agent Bench release without starting Docker."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets_domain_v1"
EXPECTED_TASK_COUNT = 107
REFERENCE_JUDGE_MODEL = "gemini-3.1-pro-preview"
PINNED_RUNTIME = (
    "acciolyk/accio_bench@"
    "sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859"
)
COLLECTIONS = {
    "all": DATASETS / "domain_v1_all.collection.json",
    "text_only": DATASETS / "domain_v1_text_only.collection.json",
    "browser_textcapable": (
        DATASETS / "domain_v1_browser_textcapable.collection.json"
    ),
    "vision": DATASETS / "domain_v1_vision.collection.json",
}

SECRET_PATTERNS = {
    "AWS access key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "Google API key": re.compile(rb"AIza[0-9A-Za-z_-]{35}"),
    "OpenAI-style API key": re.compile(
        rb"(?<![A-Za-z0-9_-])sk-(?:or-)?[A-Za-z0-9_-]{20,}"
    ),
    "GitHub token": re.compile(rb"(?:ghp|github_pat)_[A-Za-z0-9_]{20,}"),
    "Slack token": re.compile(rb"xox[baprs]-[A-Za-z0-9-]{10,}"),
    "private key": re.compile(rb"BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY"),
}


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)

    def warn(self, condition: bool, message: str) -> None:
        if not condition:
            self.warnings.append(message)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_collection(path: Path) -> list[str]:
    payload = load_json(path)
    task_ids = payload.get("task_ids")
    if not isinstance(task_ids, list) or not all(isinstance(item, str) for item in task_ids):
        raise ValueError(f"{path.relative_to(ROOT)}: task_ids must be a string list")
    return task_ids


def resolve_repo_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def load_release_config(path: Path) -> dict[str, Any]:
    """Read the small YAML subset needed by release validation.

    Run configs are simple two-level mappings. Keeping this validator
    dependency-free lets it run before `pip install -e .`.
    """
    payload: dict[str, Any] = {}
    section: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        value = value.strip("'\"")
        if indent == 0:
            if value:
                payload[key] = value
                section = None
            else:
                payload[key] = {}
                section = key
        elif indent == 2 and section:
            nested = payload.setdefault(section, {})
            if isinstance(nested, dict):
                nested[key] = value
    return payload


def tracked_files() -> list[Path]:
    if not (ROOT / ".git").exists():
        return []
    proc = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [ROOT / item.decode("utf-8") for item in proc.stdout.split(b"\0") if item]


def validate_tasks(check: Validation) -> None:
    task_by_id: dict[str, Path] = {}
    modality_ids: dict[str, set[str]] = {
        "text_only": set(),
        "browser_textcapable": set(),
        "vision": set(),
    }

    for task_toml in sorted(DATASETS.rglob("task.toml")):
        payload = tomllib.loads(task_toml.read_text(encoding="utf-8"))
        task = payload.get("task") or {}
        environment = payload.get("environment") or {}
        task_id = task.get("id")
        rel = task_toml.parent.relative_to(ROOT)
        check.require(isinstance(task_id, str) and bool(task_id), f"{rel}: missing [task].id")
        if not isinstance(task_id, str) or not task_id:
            continue
        check.require(task_id not in task_by_id, f"duplicate task id: {task_id}")
        task_by_id[task_id] = task_toml.parent

        for required in ("task.md", "rubric.json", "grader/run.sh"):
            check.require((task_toml.parent / required).is_file(), f"{rel}: missing {required}")

        check.require(
            environment.get("base_images") == [PINNED_RUNTIME],
            f"{rel}: [environment].base_images must contain only the public pinned runtime",
        )

        if bool(environment.get("requires_vision", False)):
            modality = "vision"
        elif bool(environment.get("requires_browser", False)):
            modality = "browser_textcapable"
        else:
            modality = "text_only"
        modality_ids[modality].add(task_id)

    all_ids = load_collection(COLLECTIONS["all"])
    check.require(
        len(all_ids) == EXPECTED_TASK_COUNT,
        f"full collection has {len(all_ids)} tasks; expected {EXPECTED_TASK_COUNT}",
    )
    check.require(len(all_ids) == len(set(all_ids)), "full collection contains duplicate task ids")
    check.require(
        set(all_ids) == set(task_by_id),
        "full collection and discovered task.toml ids differ",
    )

    for modality, expected_ids in modality_ids.items():
        actual = load_collection(COLLECTIONS[modality])
        check.require(len(actual) == len(set(actual)), f"{modality} collection contains duplicates")
        check.require(
            set(actual) == expected_ids,
            f"{modality} collection does not match task.toml modality declarations",
        )

    union = set().union(*modality_ids.values())
    total_memberships = sum(len(items) for items in modality_ids.values())
    check.require(union == set(all_ids), "modality collections do not cover the full collection")
    check.require(
        total_memberships == len(union),
        "modality collections overlap; every task must belong to exactly one slice",
    )

    counts = {name: len(ids) for name, ids in modality_ids.items()}
    print(
        "tasks:"
        f" all={len(all_ids)}"
        f" text_only={counts['text_only']}"
        f" browser_textcapable={counts['browser_textcapable']}"
        f" vision={counts['vision']}"
    )


def validate_configs(check: Validation) -> None:
    configs = sorted((ROOT / "configs").glob("*.yaml"))
    check.require(bool(configs), "no YAML run configurations found")
    for config_path in configs:
        payload = load_release_config(config_path)
        rel = config_path.relative_to(ROOT)
        collection = payload.get("collection")
        check.require(bool(collection), f"{rel}: missing collection")
        if collection:
            check.require(resolve_repo_path(collection).is_file(), f"{rel}: missing {collection}")

        runtime = payload.get("runtime") or {}
        check.require(
            runtime.get("image") == PINNED_RUNTIME,
            f"{rel}: runtime.image must use the v1.3.1 pinned digest",
        )

        models_config = (payload.get("openclaw") or {}).get("models_config")
        if models_config:
            models_path = resolve_repo_path(models_config)
            check.require(
                models_path.is_file(),
                f"{rel}: missing models_config {models_config}",
            )
            if models_path.is_file():
                # BYO endpoint templates: vendor-neutral starter presets
                # committed for the four common LLM wire formats. They point
                # at public defaults but are meant to be edited (or bypassed
                # via --openclaw-api) — so they are exempt from the
                # public-vendor-URL pinning below. See
                # docs/openclaw-byo-endpoint.md.
                byo_models_configs = {
                    "openai_chat_models.json",
                    "openai_responses_models.json",
                    "anthropic_messages_models.json",
                    "custom_gemini_models.json",
                }
                is_byo_preset = models_path.name in byo_models_configs
                models_payload = load_json(models_path)
                providers = models_payload.get("providers") if isinstance(models_payload, dict) else None
                check.require(
                    isinstance(providers, dict) and bool(providers),
                    f"{models_path.relative_to(ROOT)}: providers must be a non-empty object",
                )
                if isinstance(providers, dict):
                    for provider_name, provider in providers.items():
                        if not isinstance(provider, dict):
                            continue
                        api = provider.get("api")
                        base_url = str(provider.get("baseUrl") or "").rstrip("/")
                        # The vendor-URL pins apply only to the shipped
                        # public-vendor presets — a BYO template is
                        # meaningless if it is forced onto Google's public
                        # URL when the whole point is to redirect elsewhere.
                        if api == "google-generative-ai" and not is_byo_preset:
                            check.require(
                                base_url
                                == "https://generativelanguage.googleapis.com/v1beta",
                                f"{models_path.relative_to(ROOT)}: provider "
                                f"{provider_name} must use the versioned public "
                                "Gemini /v1beta base URL",
                            )
                        if provider_name == "qwen":
                            check.require(
                                base_url.endswith("/compatible-mode/v1"),
                                f"{models_path.relative_to(ROOT)}: Qwen provider "
                                "must use a versioned DashScope compatible-mode URL",
                            )
                placeholders = set(
                    re.findall(
                        r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                        models_path.read_text(encoding="utf-8"),
                    )
                )
                allowed_placeholders = {
                    "GEMINI_API_KEY",
                    "DASHSCOPE_API_KEY",
                    # BYO-endpoint templates: one env-var per wire format
                    # for the auth key, plus one URL var used by the custom
                    # Gemini template so the whole preset can be pointed at
                    # a private gateway without editing the file.
                    "OPENAI_API_KEY",
                    "ANTHROPIC_API_KEY",
                    "CUSTOM_GEMINI_API_KEY",
                    "CUSTOM_GEMINI_BASE_URL",
                }
                check.require(
                    placeholders <= allowed_placeholders,
                    f"{models_path.relative_to(ROOT)}: unsupported credential placeholders {sorted(placeholders)}",
                )

        judge = payload.get("judge") or {}
        check.require(
            judge.get("provider") in {"gemini", "openai", "mock"},
            f"{rel}: judge.provider must use a public provider implementation",
        )
        check.require(
            judge.get("model") == REFERENCE_JUDGE_MODEL,
            f"{rel}: judge.model must be {REFERENCE_JUDGE_MODEL} for the release configs",
        )
        check.require(
            not judge.get("api_key"),
            f"{rel}: do not embed judge.api_key; use provider environment variables",
        )

    print(f"configs: {len(configs)}")



def validate_readme_branding(check: Validation) -> None:
    readme_path = ROOT / "README.md"
    check.require(readme_path.is_file(), "README.md is missing")
    if not readme_path.is_file():
        return

    readme = readme_path.read_text(encoding="utf-8")
    required_assets = [
        "docs/assets/accio-logo.svg",
        "docs/assets/realreplicabench-banner.svg",
        "docs/assets/benchmark-overview.svg",
        "docs/assets/reference-leaderboard.svg",
        "docs/assets/screenshots/alibaba-publish-form.jpg",
        "docs/assets/screenshots/freightos-booking-search.jpg",
        "docs/assets/screenshots/shopify-admin-theme-customize.jpg",
    ]
    for rel in required_assets:
        path = ROOT / rel
        check.require(path.is_file() and path.stat().st_size > 0, f"missing README asset: {rel}")
        check.require(rel in readme, f"README does not reference required asset: {rel}")
        if path.suffix == ".svg" and path.is_file():
            ET.parse(path)

    palette_assets = [
        "docs/assets/realreplicabench-banner.svg",
        "docs/assets/benchmark-overview.svg",
        "docs/assets/reference-leaderboard.svg",
    ]
    legacy_purple = ("#7c3aed", "#8250df", "#a78bfa", "#f3e8ff")
    for rel in palette_assets:
        svg = (ROOT / rel).read_text(encoding="utf-8").lower()
        check.require(
            "#10b981" in svg and "#00b2ff" in svg,
            f"{rel}: missing the release green/cyan palette",
        )
        check.require(
            not any(color in svg for color in legacy_purple),
            f"{rel}: contains a legacy purple palette color",
        )

    ownership = "Developed and maintained by the Accio team at Alibaba International."
    check.require(ownership in readme, "README is missing the Accio ownership statement")
    showcase_url = "https://commerce-agent-bench-mock-showcase.site.accio.ai/"
    check.require(
        showcase_url in readme,
        "README is missing the public UI mock showcase link",
    )
    check.require(
        "https://commerce-agent-bench.site.accio.ai/" in readme,
        "README is missing the live leaderboard site link",
    )
    check.require(
        "accio-benchhub" not in readme,
        "README still links the Accio BenchHub site, which is not part of this release",
    )
    check.require(
        "https://github.com/Accio-org" in readme,
        "README is missing the Accio-org GitHub organization link",
    )
    check.require(
        "53/107 (49.5%)" in readme,
        "README does not show the selected OpenClaw GPT-5.6 Sol result",
    )
    check.require(
        "39/107 (36.4%)" in readme and "46/107 (43.0%)" in readme,
        "README does not show the aligned Gemini 3.5 Flash results",
    )
    check.require(
        all(
            model in readme
            for model in (
                "Claude Opus 5",
                "Gemini 3.6 Flash",
                "GLM 5.2",
                "DeepSeek V4 Flash",
            )
        ),
        "README does not show all twelve aligned model families",
    )
    check.require(
        "### Detailed evaluation statistics" in readme
        and "Avg. capacity" in readme
        and "Avg. steps" in readme
        and "Avg. time" in readme
        and "Avg. tokens" in readme,
        "README is missing the detailed run-statistics tables",
    )
    check.require(
        "0.860 | 47.6 | 16.4 min | 4.05M" in readme
        and "0.873 | 53.0 | 5.5 min | 1.85M" in readme,
        "README detailed statistics do not match the published leaderboard values",
    )
    check.require(
        "commerce-agent-bench.site.accio.ai" in readme and "source of record" in readme,
        "README must name the live leaderboard as the source of record",
    )
    forbidden_result_terms = (
        "best-of",
        "best_of",
        "bestof",
        "single run",
        "single-run",
        "majority-of",
        "majority_of",
        "majority3",
    )
    check.require(
        not any(term in readme.lower() for term in forbidden_result_terms),
        "public result presentation contains unsupported result-selection terminology",
    )
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    authors = (project.get("project") or {}).get("authors") or []
    check.require(
        any(isinstance(author, dict) and author.get("name") == "Accio" for author in authors),
        "pyproject.toml is missing Accio project authorship",
    )
    print(f"readme: assets={len(required_assets)} owner=Accio showcase=linked")


def validate_public_hygiene(check: Validation) -> None:
    files = tracked_files()
    if not files:
        check.warnings.append("git metadata unavailable; tracked-file hygiene scan skipped")
        return

    absolute_path_hits: list[str] = []
    secret_hits: list[str] = []
    oversized: list[str] = []
    for path in files:
        if not path.is_file():
            continue
        rel = str(path.relative_to(ROOT))
        size = path.stat().st_size
        if size >= 100 * 1024 * 1024:
            oversized.append(rel)
        data = path.read_bytes()
        if (b"/" + b"Users/") in data:
            absolute_path_hits.append(rel)
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(data):
                secret_hits.append(f"{rel} ({label})")

    check.require(not absolute_path_hits, "tracked macOS developer paths: " + ", ".join(absolute_path_hits))
    check.require(not secret_hits, "possible tracked secrets: " + ", ".join(secret_hits))
    check.require(not oversized, "tracked files at or above GitHub's 100 MiB limit: " + ", ".join(oversized))
    # The repository is open source: Apache-2.0 covers the harness and package
    # code, CC BY 4.0 covers the task suite under datasets_domain_v1. Both
    # files must ship — dropping LICENSE-DATA would silently leave the
    # 107-task dataset with no stated terms. The content checks pin each file
    # to the license it claims to be, so a half-finished relicense (one file
    # swapped, the other stale) fails here instead of shipping a repository
    # whose two halves contradict each other.
    license_file = ROOT / "LICENSE"
    check.require(license_file.is_file(), "LICENSE is missing")
    if license_file.is_file():
        license_text = license_file.read_text(encoding="utf-8")
        check.require(
            "Apache License" in license_text and "Version 2.0" in license_text,
            "LICENSE must contain the Apache License 2.0",
        )
        check.require(
            "RealReplicaBench Non-Commercial License" not in license_text,
            "LICENSE still carries the superseded non-commercial terms",
        )
    license_data = ROOT / "LICENSE-DATA"
    check.require(
        license_data.is_file(),
        "LICENSE-DATA is missing (CC BY 4.0 terms for datasets_domain_v1)",
    )
    if license_data.is_file():
        license_data_text = license_data.read_text(encoding="utf-8")
        check.require(
            "Attribution 4.0 International" in license_data_text,
            "LICENSE-DATA must contain the CC BY 4.0 legalcode",
        )
        check.require(
            "NonCommercial" not in license_data_text,
            "LICENSE-DATA still carries the superseded CC BY-NC 4.0 legalcode",
        )
    citation = ROOT / "CITATION.cff"
    check.require(citation.is_file(), "CITATION.cff is missing")
    if citation.is_file():
        citation_text = citation.read_text(encoding="utf-8")
        check.require("version: 1.3.1" in citation_text, "CITATION.cff version must be 1.3.1")

    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project_version = str((project.get("project") or {}).get("version") or "")
    init_text = (ROOT / "bench_core" / "__init__.py").read_text(encoding="utf-8")
    init_match = re.search(r'__version__\s*=\s*"([^"]+)"', init_text)
    check.require(
        bool(init_match) and init_match.group(1) == project_version,
        "package __version__ does not match pyproject.toml",
    )

    validator_path = Path(__file__).resolve()

    private_registry_hits: list[str] = []
    for path in files:
        if (
            path.is_file()
            and path.resolve() != validator_path
            and b"registry.anpm.alibaba-inc.com" in path.read_bytes()
        ):
            private_registry_hits.append(str(path.relative_to(ROOT)))
    check.require(
        not private_registry_hits,
        "private npm registry URLs remain: " + ", ".join(private_registry_hits),
    )
    print(f"hygiene: tracked_files={len(files)}")


def validate_mock_staging(check: Validation) -> None:
    """Keep the contributed-mock staging area separated from the shipped set.

    ``bench_core/mock_services/contrib/`` holds community services that
    are merged and credited but not yet part of the benchmark. The separation is
    load-bearing in three directions and each one fails silently:

    - A registry entry pointing into ``contrib/`` would put a service the image
      does not contain into the record of what the benchmark has.
    - Promotion is a move plus a registry entry plus a Dockerfile ``COPY``. Doing
      the first two and forgetting the third yields a service that runs from a
      local build and is absent from the published image — the task passes for
      whoever promoted it and fails for everyone else.
    - A task resolving its runtime mock out of ``contrib/`` would run against
      source that is in the repository but not in the image.
    """
    mock_root = ROOT / "bench_core" / "mock_services"
    contrib = mock_root / "contrib"
    check.require(
        (contrib / "README.md").is_file(),
        "mock_services/contrib/README.md is missing (staging conventions are undocumented)",
    )

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        from bench_core.mock_services.registry import MOCK_SERVICE_REGISTRY
    except ImportError as exc:
        check.warnings.append(f"mock registry not importable; staging checks skipped ({exc})")
        return

    staged = sorted(p.name for p in contrib.iterdir() if p.is_dir()) if contrib.is_dir() else []

    staged_in_registry = [name for name in staged if name in MOCK_SERVICE_REGISTRY]
    check.require(
        not staged_in_registry,
        "staged mocks are registered as shipped services: " + ", ".join(staged_in_registry),
    )

    contrib_rel = "mock_services/contrib"
    registry_in_contrib = [
        name
        for name, spec in MOCK_SERVICE_REGISTRY.items()
        if contrib_rel in spec.source_dir.replace("\\", "/")
    ]
    check.require(
        not registry_in_contrib,
        "registry entries point into the staging area: " + ", ".join(registry_in_contrib),
    )

    missing_source = [
        name
        for name, spec in MOCK_SERVICE_REGISTRY.items()
        if not resolve_repo_path(spec.source_dir).is_dir()
    ]
    check.require(
        not missing_source,
        "registry entries whose source_dir does not exist: " + ", ".join(missing_source),
    )

    dockerfile = ROOT / "docker" / "openclaw" / "Dockerfile.all-mocks"
    if dockerfile.is_file():
        dockerfile_text = dockerfile.read_text(encoding="utf-8")
        check.require(
            "COPY contrib/" not in dockerfile_text,
            "Dockerfile.all-mocks copies a staged mock into the image",
        )
        copied = set(re.findall(r"^COPY\s+([\w.-]+)/", dockerfile_text, flags=re.MULTILINE))
        # One-directional: cli_daemon is copied but is infrastructure, not a
        # registered service, so an uncopied COPY target is not an error.
        uncopied = sorted(
            name
            for name, spec in MOCK_SERVICE_REGISTRY.items()
            if spec.derived_image and name not in copied
        )
        check.require(
            not uncopied,
            "registered mocks missing a Dockerfile COPY line: " + ", ".join(uncopied),
        )

    task_hits = sorted(
        str(path.relative_to(ROOT))
        for path in DATASETS.rglob("task.toml")
        if contrib_rel in path.read_text(encoding="utf-8")
    )
    check.require(
        not task_hits,
        "tasks resolve a runtime mock out of the staging area: " + ", ".join(task_hits),
    )
    print(f"mock staging: shipped={len(MOCK_SERVICE_REGISTRY)} staged={len(staged)}")


def validate_public_remote(check: Validation) -> None:
    if not (ROOT / ".git").exists():
        check.warnings.append("git metadata unavailable; public remote check skipped")
        return
    proc = subprocess.run(
        ["git", "remote", "-v"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    remotes = {}
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            remotes.setdefault(parts[0], set()).add(parts[1])
    public = sorted(
        name
        for name, urls in remotes.items()
        if any(re.search(r"github\.com[:/]Accio-org/", url) for url in urls)
    )
    check.require(
        bool(public),
        "no remote points at the public GitHub repository (github.com/Accio-org)",
    )
    print(f"remote: remotes={len(remotes)} public={','.join(public) or 'none'}")


def main() -> int:
    check = Validation()
    try:
        validate_tasks(check)
        validate_configs(check)
        validate_readme_branding(check)
        validate_public_hygiene(check)
        validate_mock_staging(check)
        validate_public_remote(check)
    except (
        OSError,
        ValueError,
        json.JSONDecodeError,
        tomllib.TOMLDecodeError,
        ET.ParseError,
    ) as exc:
        check.errors.append(str(exc))

    for warning in check.warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    for error in check.errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if check.errors:
        print(f"release validation failed: {len(check.errors)} error(s)", file=sys.stderr)
        return 1
    print(f"release validation passed with {len(check.warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
