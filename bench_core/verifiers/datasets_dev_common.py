"""Shared helpers for ``datasets_dev/`` deterministic (no-LLM) verifiers.

Every ``datasets_dev/<task_id>/verify_<task>.py`` is a small wrapper that:

1. Loads ``private/grading_truth.json`` (hidden ground truth + per-check weights).
2. Loads the agent's outputs from ``--output-dir``.
3. Runs a small set of pure-Python checks (exact match, numeric tolerance,
   constraint feasibility, script execution against hidden inputs).
4. Calls :func:`write_reward` to emit ``reward.json`` in the schema that
   ``bench_core.cli.build_binary_final_reward`` understands as a
   "script verifier" — i.e. no ``criteria`` / ``llm_judgment`` / ``provider``
   fields, just ``score / passed / validation_checks``.

The resulting ``final_reward.json`` therefore composes:

    agent_execution + verifier_completed + script_verifier
    + every explicit entry in ``validation_checks``.

Per-task verifiers should populate ``validation_checks`` with one entry per
hard check (e.g. ``classification_exact_match``, ``tariff_within_tolerance``,
``hidden_input_script_runs``) so the run report shows the failure granularly.
"""
from __future__ import annotations

import csv
import io
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# IO helpers
# ---------------------------------------------------------------------------

def load_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def load_csv(path: Path, encoding: str = "utf-8") -> list[dict[str, str]]:
    """Best-effort CSV loader.

    Handles BOM, falls back to ``utf-8-sig`` / ``gb18030``. Returns ``[]`` if
    the file is missing or unreadable. All values returned as strings; numeric
    parsing is left to the per-task verifier.
    """
    if not path.is_file():
        return []
    raw: bytes = path.read_bytes()
    for enc in (encoding, "utf-8-sig", "gb18030", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        return []
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, data: Any) -> None:
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Comparison helpers
# ---------------------------------------------------------------------------

def to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        f = float(value)
        return f if math.isfinite(f) else None
    text = str(value).strip().replace(",", "").replace(" ", "").replace("%", "")
    if not text:
        return None
    try:
        f = float(text)
        return f if math.isfinite(f) else None
    except ValueError:
        return None


def near(actual: Any, expected: float, abs_tol: float = 0.01, rel_tol: float = 0.005) -> bool:
    """``True`` when ``actual`` is within ``max(abs_tol, |expected|*rel_tol)`` of ``expected``."""
    a = to_float(actual)
    if a is None:
        return False
    return abs(a - expected) <= max(abs_tol, abs(expected) * rel_tol)


def normalize_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def exact_match(actual: Any, expected: Any) -> bool:
    return normalize_str(actual) == normalize_str(expected)


# ---------------------------------------------------------------------------
# Validation check + reward emission
# ---------------------------------------------------------------------------

def make_check(
    check_id: str,
    *,
    passed: bool,
    score: float | None = None,
    reason: str = "",
    details: Any = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": check_id, "passed": bool(passed)}
    if score is not None:
        payload["score"] = round(float(score), 4)
    if reason:
        payload["reason"] = reason
    if details is not None:
        payload["details"] = details
    return payload


def write_reward(
    reward_path: Path,
    *,
    validation_checks: list[dict[str, Any]],
    threshold: float = 1.0,
    source: str,
    details: dict[str, Any] | None = None,
    score_mode: str = "all_pass",
) -> dict[str, Any]:
    """Emit ``reward.json`` with the shape expected by ``build_binary_final_reward``.

    ``score_mode="all_pass"`` => score is 1.0 iff every check passed, else 0.
    ``score_mode="ratio"``    => score is fraction of checks passed.

    Avoid emitting ``criteria`` / ``llm_judgment`` / ``provider`` fields here —
    the harness would otherwise treat the task as LLM-judged.
    """
    total = len(validation_checks)
    passed = sum(1 for check in validation_checks if check.get("passed"))
    if score_mode == "ratio" and total:
        score = round(passed / total, 4)
    else:
        score = 1.0 if total and passed == total else 0.0
    payload: dict[str, Any] = {
        "reward": score,
        "score": score,
        "passed": bool(total) and passed == total,
        "threshold": threshold,
        "source": source,
        "summary": f"{passed}/{total} checks passed",
        "checks_passed": passed,
        "checks_total": total,
        "validation_checks": validation_checks,
    }
    if details:
        payload["details"] = details
    write_json(reward_path, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return payload


# ---------------------------------------------------------------------------
# Subprocess helpers (for script-writing tasks)
# ---------------------------------------------------------------------------

def run_python_script(
    script_path: Path,
    *,
    args: list[str] | None = None,
    stdin: str | None = None,
    timeout: int = 30,
    cwd: Path | None = None,
) -> dict[str, Any]:
    if not script_path.is_file():
        return {"ok": False, "error": f"missing {script_path.name}", "returncode": -1, "stdout": "", "stderr": ""}
    cmd = [sys.executable, str(script_path), *(args or [])]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or script_path.parent),
            input=stdin,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "error": "timeout",
            "returncode": -1,
            "stdout": (exc.stdout or "")[-500:] if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "")[-500:] if isinstance(exc.stderr, str) else "",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "returncode": -1, "stdout": "", "stderr": ""}
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr[-2000:],
    }


def call_function_in_script(
    script_path: Path,
    function_name: str,
    payload: Any,
    *,
    timeout: int = 30,
) -> dict[str, Any]:
    """Spawn a subprocess that imports the agent's script and calls ``function_name(payload)``.

    Returns ``{ok, returncode, stdout, stderr, parsed}`` where ``parsed`` is the
    JSON-decoded return value when possible. Use this for hidden-input
    regression tests when the agent ships a Python module.
    """
    if not script_path.is_file():
        return {"ok": False, "error": f"missing {script_path.name}"}
    runner = (
        "import importlib.util, json, sys\n"
        "sys.dont_write_bytecode = True\n"
        f"spec = importlib.util.spec_from_file_location('agent_module', '{script_path.name}')\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(module)\n"
        f"fn = getattr(module, '{function_name}', None)\n"
        "if fn is None:\n"
        "    print('ERROR_FN_MISSING'); sys.exit(2)\n"
        "payload = json.loads(sys.stdin.read())\n"
        "result = fn(payload)\n"
        "print(json.dumps(result, ensure_ascii=False, default=str))\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", runner],
            cwd=str(script_path.parent),
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    parsed = None
    if proc.returncode == 0 and proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout.strip().splitlines()[-1])
        except Exception:
            parsed = None
    return {
        "ok": proc.returncode == 0 and parsed is not None,
        "returncode": proc.returncode,
        "stdout": proc.stdout[-1000:],
        "stderr": proc.stderr[-1500:],
        "parsed": parsed,
    }


# ---------------------------------------------------------------------------
# Row-level CSV diff
# ---------------------------------------------------------------------------

def row_diff(
    actual_rows: list[dict[str, Any]],
    expected_rows: list[dict[str, Any]],
    *,
    key: str,
    field_specs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Compare two row sets keyed by ``key``.

    ``field_specs`` maps a field name to a spec describing how to compare it::

        {"price_cny": {"kind": "numeric", "abs_tol": 0.01, "rel_tol": 0.005},
         "hs_code":   {"kind": "exact"},
         "tags":      {"kind": "set", "sep": "|"}}

    Returns counts plus a list of mismatches (at most 25).
    """
    actual_by_key = {normalize_str(row.get(key)): row for row in actual_rows}
    expected_by_key = {normalize_str(row.get(key)): row for row in expected_rows}

    mismatches: list[dict[str, Any]] = []
    missing_keys: list[str] = []
    extra_keys: list[str] = []
    row_perfect = 0
    field_total = 0
    field_passed = 0

    for k, expected_row in expected_by_key.items():
        actual_row = actual_by_key.get(k)
        if actual_row is None:
            missing_keys.append(k)
            field_total += len(field_specs)
            mismatches.append({"key": k, "issue": "missing_row"})
            continue
        row_ok = True
        for field, spec in field_specs.items():
            field_total += 1
            kind = spec.get("kind", "exact")
            exp_val = expected_row.get(field)
            act_val = actual_row.get(field)
            if kind == "numeric":
                if exp_val is None or exp_val == "":
                    ok = act_val in (None, "")
                else:
                    target = to_float(exp_val)
                    ok = target is not None and near(
                        act_val,
                        target,
                        abs_tol=spec.get("abs_tol", 0.01),
                        rel_tol=spec.get("rel_tol", 0.005),
                    )
            elif kind == "set":
                sep = spec.get("sep", "|")
                exp_set = {p.strip().lower() for p in str(exp_val or "").split(sep) if p.strip()}
                act_set = {p.strip().lower() for p in str(act_val or "").split(sep) if p.strip()}
                ok = exp_set == act_set
            elif kind == "bool":
                ok = _to_bool(act_val) == _to_bool(exp_val)
            else:
                ok = exact_match(act_val, exp_val)
            if ok:
                field_passed += 1
            else:
                row_ok = False
                if len(mismatches) < 25:
                    mismatches.append({"key": k, "field": field, "expected": exp_val, "actual": act_val})
        if row_ok:
            row_perfect += 1

    for k in actual_by_key:
        if k not in expected_by_key:
            extra_keys.append(k)

    return {
        "total_rows": len(expected_by_key),
        "rows_perfect": row_perfect,
        "field_total": field_total,
        "field_passed": field_passed,
        "field_accuracy": round(field_passed / field_total, 4) if field_total else 0.0,
        "row_accuracy": round(row_perfect / len(expected_by_key), 4) if expected_by_key else 0.0,
        "missing_rows": missing_keys[:25],
        "extra_rows": extra_keys[:25],
        "mismatches": mismatches,
    }


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in {"true", "1", "yes", "y", "t", "ok", "valid", "通过", "是"}


# ---------------------------------------------------------------------------
# CLI scaffolding for per-task verifiers
# ---------------------------------------------------------------------------

def parse_standard_args(prog: str) -> Any:
    import argparse
    parser = argparse.ArgumentParser(prog=prog)
    parser.add_argument("--task-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reward-json", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path)
    # Accept-but-ignore so the standard test.sh template works unchanged for
    # both LLM-judged and deterministic tasks.
    parser.add_argument("--task-md", type=Path)
    parser.add_argument("--rubric-json", type=Path)
    parser.add_argument("--result-json", type=Path)
    parser.add_argument("--trajectory-json", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.out and not args.reward_json:
        args.reward_json = args.out
    return args
