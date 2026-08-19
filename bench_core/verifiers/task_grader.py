"""Shared host-side grader for tasks whose scoring is a deterministic Python
function shipped per-task as ``datasets/<slug>/_grader.py``.

This grader is invoked from each task's ``test.sh``. It:

1. Builds a sandbox directory that mirrors the in-container ``/tmp_workspace/``
   layout (``{fixtures, results, gt, ...}``) by symlinking entries from
   ``FILES_DIR`` (= ``datasets/<slug>/files/``), ``OUTPUT_DIR`` (agent's final
   artifacts), and ``PRIVATE_DIR`` (= ``datasets/<slug>/private/``).
2. Monkey-patches ``pathlib.Path`` so the per-task ``grade()`` function's
   hard-coded ``/tmp_workspace/...`` paths transparently resolve into the
   sandbox.
3. Exposes ``MOCK_SITE_URL`` (set by the harness via ``host_published_port``)
   so graders that poll an in-container mock's audit endpoint keep working
   without rewriting their hard-coded ``http://localhost:920x`` URLs.
4. Imports ``datasets/<slug>/_grader.py`` and calls its ``grade()`` function.
5. Writes ``reward.json`` with the **continuous** deterministic
   ``overall_score`` (range [0, 1]) plus a ``passed`` boolean keyed on each
   task's ``rubric.minimum_pass_score`` and a ``validation_checks`` array.

Scoring semantics versus the CCB main harness
---------------------------------------------

Commerce Agent Bench's ``cli.py`` always rebuilds ``final_reward.json`` from
``reward.json`` via ``build_binary_final_reward`` (see ``cli.py``: every run
re-runs this aggregation regardless of what the verifier wrote). That function:

  - sets ``final_reward.reward = final_reward.score = 1.0`` only when every
    validation check (incl. our ``task_grader_overall``) passes, else ``0.0``;
  - **preserves the continuous score as ``raw_reward`` / ``raw_score``**;
  - preserves the bool as ``raw_passed``.

So under the real harness, the source of truth for the "continuous final
reward" view is ``final_reward.json.raw_score`` (identical to
``reward.json.score`` and to ``raw_breakdown.overall_score``).

This module also writes ``final_reward.json`` directly (continuous), but that
only matters for offline single-task smoke paths that bypass the CCB main
harness.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import tempfile
from typing import Any

# Use the concrete platform class throughout the shared grader. After we install
# the redirect below, ``pathlib.Path`` becomes a function and any later code
# (including pathlib's own ``Path.__new__`` dispatch) that tries to use the
# abstract ``Path`` class fails with ``'Path' has no attribute '_flavour'``.
_OrigPath = pathlib.WindowsPath if os.name == "nt" else pathlib.PosixPath


def _read_json(path: _OrigPath) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def _install_path_redirect(shadow_root: str) -> None:
    """Replace ``pathlib.Path`` so ``Path("/tmp_workspace/...")`` resolves
    into ``shadow_root``. Other paths pass through unchanged.

    Note: we dispatch to the concrete ``PosixPath``/``WindowsPath`` class
    rather than to ``pathlib.Path``: ``Path.__new__`` does ``if cls is Path:
    cls = PosixPath`` to pick a flavour, and that check fails after we've
    rebound ``pathlib.Path`` to a function (the saved ``_orig`` reference
    still points at the *abstract* ``Path`` class).
    """

    concrete = pathlib.WindowsPath if os.name == "nt" else pathlib.PosixPath
    prefix = "/tmp_workspace"

    def _redirected(*args: Any, **kwargs: Any):
        if args and isinstance(args[0], str) and args[0].startswith(prefix):
            tail = args[0][len(prefix):]
            new_first = shadow_root + tail
            args = (new_first,) + args[1:]
        return concrete(*args, **kwargs)

    pathlib.Path = _redirected  # type: ignore[assignment]


def _build_sandbox(
    sandbox: _OrigPath,
    files_dir: _OrigPath,
    output_dir: _OrigPath,
    private_dir: _OrigPath,
) -> None:
    """Symlink files_dir contents, OUTPUT_DIR, and PRIVATE_DIR into the sandbox.

    - Every top-level entry under ``files_dir`` (except reserved names) becomes
      a symlink directly under ``sandbox`` so ``Path("/tmp_workspace/<x>")``
      finds it.
    - ``sandbox/results`` always points at ``output_dir`` (agent artifacts).
    - ``sandbox/gt`` always points at ``private_dir`` (hidden ground truth).
    """

    sandbox.mkdir(parents=True, exist_ok=True)
    reserved = {"results", "gt", "start_mock_services.sh"}
    if files_dir.exists():
        for entry in files_dir.iterdir():
            if entry.name in reserved:
                continue
            target = sandbox / entry.name
            if target.exists() or target.is_symlink():
                continue
            target.symlink_to(entry.resolve())

    results_link = sandbox / "results"
    if results_link.exists() or results_link.is_symlink():
        results_link.unlink()
    output_dir.mkdir(parents=True, exist_ok=True)
    results_link.symlink_to(output_dir.resolve())

    gt_link = sandbox / "gt"
    if gt_link.exists() or gt_link.is_symlink():
        gt_link.unlink()
    if private_dir.exists():
        gt_link.symlink_to(private_dir.resolve())
    else:
        gt_link.mkdir(parents=True, exist_ok=True)


def _maybe_install_host_deps(dataset_dir: _OrigPath) -> None:
    """If ``host_deps.txt`` exists in the dataset dir, best-effort pip install."""

    deps_file = dataset_dir / "host_deps.txt"
    if not deps_file.exists():
        return
    pkgs = [
        line.strip()
        for line in deps_file.read_text(encoding="utf-8-sig").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    missing: list[str] = []
    for pkg in pkgs:
        import_name = pkg.split("[")[0].split("==")[0].split(">=")[0].strip()
        import_name = {
            "pyyaml": "yaml",
            "python-docx": "docx",
        }.get(import_name.lower(), import_name)
        try:
            __import__(import_name)
        except Exception:
            missing.append(pkg)
    if not missing:
        return
    import subprocess

    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", *missing],
        check=False,
    )


def _load_grader(grader_path: _OrigPath):
    spec = importlib.util.spec_from_file_location("ccb_task_grader", grader_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load grader module from {grader_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["ccb_task_grader"] = module
    spec.loader.exec_module(module)
    grade = getattr(module, "grade", None)
    if not callable(grade):
        raise RuntimeError(f"grader module {grader_path} has no callable grade()")
    return grade


def _continuous(value: Any) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    if f != f:  # NaN guard
        return 0.0
    return max(0.0, min(1.0, f))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", required=True, help="path to datasets/<slug>/")
    parser.add_argument("--result-json", default=os.environ.get("RESULT_JSON", "/output/result.json"))
    parser.add_argument("--reward-json", default=os.environ.get("REWARD_JSON", "/output/reward.json"))
    parser.add_argument(
        "--final-reward-json",
        default=os.environ.get(
            "FINAL_REWARD_JSON",
            str(_OrigPath(os.environ.get("REWARD_JSON", "/output/reward.json")).with_name("final_reward.json")),
        ),
    )
    parser.add_argument("--output-dir", default=os.environ.get("OUTPUT_DIR", ""))
    parser.add_argument("--files-dir", default="")
    parser.add_argument("--private-dir", default="")
    parser.add_argument("--rubric-json", default="")
    parser.add_argument("--min-pass-score", type=float, default=None)
    args = parser.parse_args()

    dataset_dir = _OrigPath(args.dataset_dir).resolve()
    files_dir = _OrigPath(args.files_dir or (dataset_dir / "files")).resolve()
    private_dir = _OrigPath(args.private_dir or (dataset_dir / "private")).resolve()
    output_dir = _OrigPath(args.output_dir).resolve() if args.output_dir else dataset_dir / "_dummy_outputs"
    grader_path = dataset_dir / "_grader.py"
    rubric_path = _OrigPath(args.rubric_json or (dataset_dir / "rubric.json"))

    rubric = _read_json(rubric_path) if rubric_path.exists() else {}
    threshold = (
        args.min_pass_score
        if args.min_pass_score is not None
        else float(rubric.get("minimum_pass_score", 0.7))
    )

    _maybe_install_host_deps(dataset_dir)

    sandbox = _OrigPath(tempfile.mkdtemp(prefix="task_grader_sandbox_"))
    try:
        _build_sandbox(sandbox, files_dir, output_dir, private_dir)
        _install_path_redirect(str(sandbox))

        os.environ.setdefault("MOCK_SITE_URL", os.environ.get("MOCK_SITE_URL", ""))
        os.environ["TASK_GRADER_SANDBOX"] = str(sandbox)

        try:
            grade = _load_grader(grader_path)
            raw_scores = grade()
            if not isinstance(raw_scores, dict):
                raw_scores = {"overall_score": 0.0, "error": "grade_returned_non_dict"}
        except Exception as exc:  # noqa: BLE001
            raw_scores = {
                "overall_score": 0.0,
                "error": f"{type(exc).__name__}: {str(exc)[:240]}",
            }

        overall = _continuous(raw_scores.get("overall_score", 0.0))
        passed = overall >= threshold

        reward_payload: dict[str, Any] = {
            "reward": overall,
            "score": overall,
            "passed": passed,
            "source": "task_grader",
            "scoring_mode": "continuous",
            "threshold": threshold,
            "raw_breakdown": raw_scores,
            # Hint for downstream tooling: after CCB main rebuilds the final
            # reward, the continuous diagnostic value lives in `raw_score`.
            "continuous_score_field": "raw_score",
        }
        if "error" in raw_scores:
            reward_payload["error"] = raw_scores["error"]

        reward_out = _OrigPath(args.reward_json)
        reward_out.parent.mkdir(parents=True, exist_ok=True)
        reward_out.write_text(
            json.dumps(reward_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        final_payload: dict[str, Any] = {
            "reward": overall,
            "score": overall,
            "passed": passed,
            "raw_reward": overall,
            "raw_score": overall,
            "raw_passed": passed,
            "source": "task_grader",
            "scoring_mode": "continuous",
            "threshold": threshold,
            "check_summary": {
                "deterministic_grader": passed,
            },
            "validation_checks": [
                {
                    "id": "task_grader_overall",
                    "name": "Task deterministic overall_score",
                    "passed": passed,
                    "threshold": threshold,
                    "value": overall,
                }
            ],
        }
        final_out = _OrigPath(args.final_reward_json)
        final_out.parent.mkdir(parents=True, exist_ok=True)
        final_out.write_text(
            json.dumps(final_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        print(json.dumps(reward_payload, ensure_ascii=False, indent=2))
        return 0
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
