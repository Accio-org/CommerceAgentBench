#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bench_core.reports.html_report import generate_instance_report

RUNS_DIR = ROOT / "runs"


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def dump_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "" or any(ch in text for ch in ":#[]{}&,!*?|>'\"%@`"):
        return json.dumps(text, ensure_ascii=False)
    return text


def write_run_yaml(instance_dir: Path, summary: dict[str, Any]) -> None:
    run_id = summary.get("run_id") or summary.get("batch_id") or instance_dir.name
    lines = [
        f"run_id: {yaml_scalar(run_id)}",
        f"collection: {yaml_scalar(summary.get('collection'))}",
        "runtime:",
        f"  os: {yaml_scalar(summary.get('runtime_os'))}",
        f"  image: {yaml_scalar(summary.get('image'))}",
        "harness: " + yaml_scalar(summary.get("harness") or "accio"),
        "agent:",
        f"  model_provider: {yaml_scalar(summary.get('model_provider'))}",
        f"  model_name: {yaml_scalar(summary.get('model_name'))}",
        "judge:",
        f"  provider: {yaml_scalar(summary.get('llm_judge_provider'))}",
        f"  model: {yaml_scalar(summary.get('llm_judge_model'))}",
        "tasks:",
    ]
    for row in summary.get("results", []):
        if isinstance(row, dict) and row.get("task_id"):
            lines.append(f"  - {yaml_scalar(row['task_id'])}")
    lines.extend(
        [
            "output:",
            f"  instance_dir: {yaml_scalar(instance_dir)}",
            f"  task_runs_dir: {yaml_scalar(instance_dir / 'tasks')}",
            f"  summary_json: {yaml_scalar(instance_dir / 'summary.json')}",
            f"  summary_md: {yaml_scalar(instance_dir / 'summary.md')}",
        ]
    )
    (instance_dir / "run.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_summary_md(instance_dir: Path, summary: dict[str, Any]) -> None:
    rows = summary.get("results", [])
    passed = sum(1 for row in rows if isinstance(row, dict) and row.get("passed"))
    lines = [
        f"# {summary.get('run_id') or summary.get('batch_id') or instance_dir.name}",
        "",
        f"- started_at: {summary.get('started_at')}",
        f"- updated_at: {datetime.now().isoformat()}",
        f"- config: `{instance_dir / 'run.yaml'}`",
        f"- runtime_os: {summary.get('runtime_os')}",
        f"- harness: {summary.get('harness') or 'accio'}",
        f"- image: `{summary.get('image')}`",
        f"- model: `{summary.get('model_provider')}/{summary.get('model_name')}`",
        f"- judge: `{summary.get('llm_judge_provider')}/{summary.get('llm_judge_model')}`",
        f"- progress: {len(rows)}/{summary.get('total', len(rows))} complete, {passed} passed",
        "",
        "| # | task | exit | score | passed | outputs | cleanup | run_dir |",
        "|---:|---|---:|---:|---|---:|---|---|",
    ]
    for row in rows:
        if not isinstance(row, dict):
            continue
        lines.append(
            "| {index} | {task_id} | {returncode} | {score} | {passed} | {outputs} | {cleanup} | `{run_dir}` |".format(
                index=row.get("index"),
                task_id=row.get("task_id"),
                returncode=row.get("returncode"),
                score=row.get("score", ""),
                passed=row.get("passed", ""),
                outputs=row.get("output_file_count", 0),
                cleanup=row.get("container_removed", ""),
                run_dir=row.get("run_dir", ""),
            )
        )
    (instance_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def move_file(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    shutil.move(str(src), str(dst))


def organize_batch(batch_dir: Path) -> Path | None:
    if not batch_dir.name.endswith("__batch"):
        return None
    run_id = batch_dir.name[: -len("__batch")]
    instance_dir = RUNS_DIR / run_id
    instance_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = instance_dir / "logs"
    tasks_dir = instance_dir / "tasks"
    logs_dir.mkdir(exist_ok=True)
    tasks_dir.mkdir(exist_ok=True)

    move_file(batch_dir / "summary.json", instance_dir / "summary.json")
    move_file(batch_dir / "summary.md", instance_dir / "summary.md")
    for log in sorted(batch_dir.glob("*.command.log")):
        move_file(log, logs_dir / log.name)

    pattern = re.compile(rf"^{re.escape(run_id)}-(\d{{2}}-.+)$")
    for child in sorted(RUNS_DIR.iterdir()):
        if not child.is_dir() or child == instance_dir or child == batch_dir:
            continue
        match = pattern.match(child.name)
        if not match:
            continue
        target = tasks_dir / match.group(1)
        if target.exists():
            continue
        shutil.move(str(child), str(target))

    summary = load_json(instance_dir / "summary.json", {})
    summary["run_id"] = summary.get("run_id") or summary.get("batch_id") or run_id
    summary["config_path"] = str(instance_dir / "run.yaml")
    for row in summary.get("results", []):
        if not isinstance(row, dict):
            continue
        old_run_id = str(row.get("run_id") or "")
        task_run_name = old_run_id.removeprefix(run_id + "-")
        if not task_run_name:
            task_run_name = f"{int(row.get('index', 0)):02d}-{row.get('task_id')}"
        row["run_id"] = task_run_name
        row["run_dir"] = str(tasks_dir / task_run_name)
    dump_json(instance_dir / "summary.json", summary)
    write_run_yaml(instance_dir, summary)
    write_summary_md(instance_dir, summary)
    generate_instance_report(instance_dir)

    try:
        batch_dir.rmdir()
    except OSError:
        pass
    return instance_dir


def main() -> int:
    organized = []
    for batch_dir in sorted(RUNS_DIR.glob("*__batch")):
        instance = organize_batch(batch_dir)
        if instance:
            organized.append(instance)
    for instance in organized:
        print(instance)
    print(f"organized={len(organized)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
