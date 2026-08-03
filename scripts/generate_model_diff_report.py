#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import statistics
import tomllib
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def pct(value: float | int | None, digits: int = 1) -> str:
    if value is None or not math.isfinite(float(value)):
        return "n/a"
    return f"{float(value) * 100:.{digits}f}%"


def fmt_num(value: Any, digits: int = 3) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return f"{float(value):.{digits}f}".rstrip("0").rstrip(".")
    return str(value)


def short_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def task_meta(task_id: str) -> dict[str, Any]:
    path = DATASETS / task_id / "task.toml"
    if not path.is_file():
        return {"name": task_id, "keywords": []}
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    task = data.get("task", {})
    return {
        "name": task.get("name") or task_id,
        "keywords": task.get("keywords") or [],
    }


def group_for(task_id: str, keywords: list[str]) -> str:
    keys = set(keywords)
    if "publish" in task_id or "publish" in keys:
        return "Publish / Form"
    if "mock" in task_id or "mock" in keys or "ui" in keys or "procurement" in keys:
        return "Mock Workflow / UI"
    if {"image", "visual", "design", "creative"} & keys:
        return "Visual / Design"
    if {"excel", "calculator", "finance", "python", "pricing"} & keys:
        return "Structured Data / Engineering"
    if {"research", "report", "sourcing", "seo"} & keys:
        return "Research / Writing"
    return "Other"


def result_reward(row: dict[str, Any]) -> float:
    return 1.0 if row.get("passed") is True or row.get("score") == 1.0 else 0.0


def result_status(row: dict[str, Any]) -> str:
    if not row:
        return "missing"
    if row.get("passed") is True:
        return "pass"
    if row.get("score") is None or row.get("returncode") not in (0, 6):
        return "exception"
    return "fail"


def check_text(row: dict[str, Any]) -> str:
    total = row.get("checks_total")
    passed = row.get("checks_passed")
    if total is None:
        return "-"
    return f"{passed}/{total}"


def make_metrics(summary: dict[str, Any]) -> dict[str, Any]:
    rows = summary.get("results", [])
    total = int(summary.get("total") or len(rows))
    passed = sum(1 for row in rows if result_reward(row) == 1.0)
    failures = total - passed
    exceptions = sum(1 for row in rows if result_status(row) == "exception")
    agent_timeouts = sum(1 for row in rows if row.get("agent_exec_returncode") == 124)
    nonzero_agent = sum(
        1 for row in rows
        if row.get("agent_exec_returncode") not in (0, None)
    )
    raw_scores = [float(row.get("raw_score") or 0.0) for row in rows]
    llm_scores = [float(row.get("llm_judge_score") or 0.0) for row in rows]
    return {
        "total": total,
        "passed": passed,
        "failures": failures,
        "solve_rate": passed / total if total else 0.0,
        "exceptions": exceptions,
        "agent_timeouts": agent_timeouts,
        "nonzero_agent": nonzero_agent,
        "avg_raw_score": statistics.fmean(raw_scores) if raw_scores else 0.0,
        "avg_llm_score": statistics.fmean(llm_scores) if llm_scores else 0.0,
    }


def badge(text: str, kind: str = "") -> str:
    return f'<span class="badge {escape(kind)}">{escape(text)}</span>'


def row_badge(row: dict[str, Any]) -> str:
    status = result_status(row)
    if status == "pass":
        return badge("reward 1", "pass")
    if status == "exception":
        return badge("exception", "exception")
    if status == "missing":
        return badge("missing", "exception")
    return badge("reward 0", "fail")


def relative(from_path: Path, to_path: Path) -> str:
    try:
        return str(to_path.resolve().relative_to(from_path.resolve().parent))
    except ValueError:
        return str(to_path)


def build_report(baseline_dir: Path, candidate_dir: Path, output: Path, baseline_label: str, candidate_label: str) -> str:
    baseline_summary = read_json(baseline_dir / "summary.json")
    candidate_summary = read_json(candidate_dir / "summary.json")
    baseline_rows = {row["task_id"]: row for row in baseline_summary.get("results", [])}
    candidate_rows = {row["task_id"]: row for row in candidate_summary.get("results", [])}
    order = [row["task_id"] for row in candidate_summary.get("results", [])]
    for task_id in baseline_rows:
        if task_id not in order:
            order.append(task_id)

    baseline_metrics = make_metrics(baseline_summary)
    candidate_metrics = make_metrics(candidate_summary)
    delta_rate = candidate_metrics["solve_rate"] - baseline_metrics["solve_rate"]

    buckets = {
        "new_wins": [],
        "regressions": [],
        "both_pass": [],
        "both_fail": [],
    }
    rows: list[dict[str, Any]] = []
    group_stats: dict[str, dict[str, int]] = {}
    for index, task_id in enumerate(order, 1):
        base = baseline_rows.get(task_id, {})
        cand = candidate_rows.get(task_id, {})
        meta = task_meta(task_id)
        keywords = [str(item) for item in meta.get("keywords", [])]
        group = group_for(task_id, keywords)
        base_pass = result_reward(base) == 1.0
        cand_pass = result_reward(cand) == 1.0
        if cand_pass and not base_pass:
            bucket = "new_wins"
        elif base_pass and not cand_pass:
            bucket = "regressions"
        elif base_pass and cand_pass:
            bucket = "both_pass"
        else:
            bucket = "both_fail"
        buckets[bucket].append(task_id)

        group_row = group_stats.setdefault(group, {"total": 0, "baseline": 0, "candidate": 0})
        group_row["total"] += 1
        group_row["baseline"] += 1 if base_pass else 0
        group_row["candidate"] += 1 if cand_pass else 0

        rows.append(
            {
                "index": index,
                "task_id": task_id,
                "name": str(meta.get("name") or task_id),
                "keywords": ", ".join(keywords[:5]),
                "group": group,
                "bucket": bucket,
                "baseline": base,
                "candidate": cand,
                "delta": result_reward(cand) - result_reward(base),
            }
        )

    cards = [
        ("Baseline reward=1", str(baseline_metrics["passed"]), pct(baseline_metrics["solve_rate"])),
        ("新模型 reward=1", str(candidate_metrics["passed"]), pct(candidate_metrics["solve_rate"])),
        ("Solve-rate delta", f"{delta_rate * 100:+.1f} pp", "新模型 - baseline"),
        ("New wins / regressions", f"{len(buckets['new_wins'])} / {len(buckets['regressions'])}", "按 binary reward"),
        ("Candidate exceptions", str(candidate_metrics["exceptions"]), "score=None 或非标准退出"),
        ("Candidate agent timeouts", str(candidate_metrics["agent_timeouts"]), "agent_exec_returncode=124"),
    ]

    def list_items(items: list[str]) -> str:
        if not items:
            return '<p class="muted">无</p>'
        return "<ul>" + "".join(f"<li><code>{escape(item)}</code></li>" for item in items) + "</ul>"

    group_rows = []
    for group, stat in sorted(group_stats.items()):
        total = stat["total"]
        group_rows.append(
            "<tr>"
            f"<td>{escape(group)}</td>"
            f"<td>{stat['baseline']}/{total}<span class=\"muted\"> ({pct(stat['baseline']/total)})</span></td>"
            f"<td>{stat['candidate']}/{total}<span class=\"muted\"> ({pct(stat['candidate']/total)})</span></td>"
            f"<td>{stat['candidate'] - stat['baseline']:+d}</td>"
            "</tr>"
        )

    table_rows = []
    for row in rows:
        base = row["baseline"]
        cand = row["candidate"]
        delta_class = "pos" if row["delta"] > 0 else "neg" if row["delta"] < 0 else "zero"
        base_link = Path(base.get("run_dir", "")) / "report.html" if base.get("run_dir") else baseline_dir / "report.html"
        cand_link = Path(cand.get("run_dir", "")) / "report.html" if cand.get("run_dir") else candidate_dir / "report.html"
        table_rows.append(
            "<tr data-bucket=\"{bucket}\" data-group=\"{group}\">".format(
                bucket=escape(row["bucket"]),
                group=escape(row["group"]),
            )
            + f"<td class=\"num\">{row['index']}</td>"
            + f"<td><div class=\"task-id\">{escape(row['task_id'])}</div><div class=\"task-name\">{escape(row['name'])}</div><div class=\"chips\">{badge(row['group'], 'group')}</div></td>"
            + f"<td>{row_badge(base)}<div class=\"tiny\">raw {fmt_num(base.get('raw_score'))}</div></td>"
            + f"<td>{fmt_num(base.get('llm_judge_score'))}<div class=\"tiny\">LLM check {escape(str(base.get('llm_check_passed')))}</div></td>"
            + f"<td>{escape(check_text(base))}</td>"
            + f"<td>{row_badge(cand)}<div class=\"tiny\">raw {fmt_num(cand.get('raw_score'))}</div></td>"
            + f"<td>{fmt_num(cand.get('llm_judge_score'))}<div class=\"tiny\">LLM check {escape(str(cand.get('llm_check_passed')))}</div></td>"
            + f"<td>{escape(check_text(cand))}</td>"
            + f"<td class=\"delta {delta_class}\">{row['delta']:+.0f}</td>"
            + f"<td><div>{badge(row['bucket'].replace('_', ' '), row['bucket'])}</div><div class=\"tiny\">candidate agent rc={escape(str(cand.get('agent_exec_returncode')))}</div></td>"
            + f"<td class=\"summary-cell\"><details><summary>baseline</summary><p>{escape(short_text(base.get('summary'), 600))}</p><a href=\"{escape(relative(output, base_link))}\">task report</a></details><details><summary>新模型</summary><p>{escape(short_text(cand.get('summary'), 600))}</p><a href=\"{escape(relative(output, cand_link))}\">task report</a></details></td>"
            + "</tr>"
        )

    baseline_report = relative(output, baseline_dir / "report.html")
    candidate_report = relative(output, candidate_dir / "report.html")
    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    data_json = escape(json.dumps({"baseline": baseline_summary, "candidate": candidate_summary}, ensure_ascii=False))

    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RealReplicaBench Model Diff</title>
<style>
:root {{
  --bg: #f7f8fb;
  --panel: #ffffff;
  --ink: #18202f;
  --muted: #647084;
  --line: #dfe5ee;
  --pass: #107c41;
  --fail: #b42318;
  --warn: #a15c00;
  --blue: #2757d9;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.45;
}}
header {{
  padding: 28px 32px 22px;
  background: #111827;
  color: #fff;
}}
h1 {{ margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }}
h2 {{ margin: 0 0 14px; font-size: 20px; }}
h3 {{ margin: 0 0 10px; font-size: 16px; }}
a {{ color: var(--blue); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.subtitle {{ color: #cbd5e1; max-width: 1100px; }}
.wrap {{ padding: 22px 32px 44px; max-width: 1600px; margin: 0 auto; }}
.grid {{ display: grid; gap: 14px; }}
.cards {{ grid-template-columns: repeat(6, minmax(150px, 1fr)); margin-bottom: 18px; }}
.card, .panel {{
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}}
.card {{ padding: 14px 16px; }}
.card .label {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }}
.card .value {{ font-size: 26px; font-weight: 700; margin-top: 4px; }}
.card .note {{ color: var(--muted); font-size: 12px; margin-top: 2px; }}
.panel {{ padding: 18px; margin: 16px 0; }}
.two {{ grid-template-columns: 1fr 1fr; }}
.three {{ grid-template-columns: 1.1fr 1fr 1fr; }}
.model-box {{ display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 14px; }}
.key {{ color: var(--muted); }}
.muted, .tiny {{ color: var(--muted); }}
.tiny {{ font-size: 12px; margin-top: 3px; }}
.judgment {{
  border-left: 4px solid var(--blue);
  padding: 10px 12px;
  background: #eef4ff;
  border-radius: 6px;
}}
table {{ width: 100%; border-collapse: collapse; }}
th, td {{ border-bottom: 1px solid var(--line); padding: 10px 9px; vertical-align: top; text-align: left; }}
th {{
  position: sticky;
  top: 0;
  background: #f1f5f9;
  z-index: 1;
  font-size: 12px;
  color: #334155;
  white-space: nowrap;
}}
tbody tr:hover {{ background: #fafcff; }}
.num {{ text-align: right; color: var(--muted); }}
.task-id {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; }}
.task-name {{ color: var(--muted); font-size: 13px; margin-top: 3px; max-width: 360px; }}
.badge {{
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  white-space: nowrap;
  background: #fff;
}}
.badge.pass {{ color: var(--pass); border-color: #b7e2c5; background: #eefbf2; }}
.badge.fail {{ color: var(--fail); border-color: #f2b8b5; background: #fff1f0; }}
.badge.exception {{ color: var(--warn); border-color: #f3d19c; background: #fff8e7; }}
.badge.new_wins {{ color: var(--pass); border-color: #b7e2c5; background: #eefbf2; }}
.badge.regressions {{ color: var(--fail); border-color: #f2b8b5; background: #fff1f0; }}
.badge.both_pass {{ color: var(--blue); border-color: #bcd1ff; background: #eef4ff; }}
.badge.both_fail {{ color: #475569; border-color: #cbd5e1; background: #f8fafc; }}
.badge.group {{ color: #334155; background: #f8fafc; }}
.delta {{ font-weight: 700; text-align: center; }}
.delta.pos {{ color: var(--pass); }}
.delta.neg {{ color: var(--fail); }}
.delta.zero {{ color: var(--muted); }}
.summary-cell {{ min-width: 320px; max-width: 520px; }}
details {{ margin-bottom: 7px; }}
summary {{ cursor: pointer; color: var(--blue); }}
details p {{ margin: 6px 0; color: #334155; }}
.toolbar {{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}}
button, input {{
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
}}
button.active {{ background: #111827; color: #fff; border-color: #111827; }}
input {{ min-width: 280px; }}
.table-wrap {{ overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }}
ul {{ margin: 8px 0 0; padding-left: 20px; }}
code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
@media (max-width: 1100px) {{
  .cards, .two, .three {{ grid-template-columns: 1fr; }}
  header, .wrap {{ padding-left: 18px; padding-right: 18px; }}
}}
</style>
</head>
<body>
<header>
  <h1>RealReplicaBench 模型对比</h1>
  <div class="subtitle">Baseline：{escape(baseline_label)}；Candidate：{escape(candidate_label)}。生成时间：{escape(generated)}。最终 reward 按 binary 全检查通过计算，exception 不剔除。</div>
</header>
<main class="wrap">
  <section class="grid cards">
    {''.join(f'<div class="card"><div class="label">{escape(label)}</div><div class="value">{escape(value)}</div><div class="note">{escape(note)}</div></div>' for label, value, note in cards)}
  </section>

  <section class="panel">
    <h2>结论</h2>
    <div class="judgment">
      新模型在完整集上的 solve rate 为 <strong>{candidate_metrics["passed"]}/{candidate_metrics["total"]} ({pct(candidate_metrics["solve_rate"])})</strong>，
      低于 baseline 的 <strong>{baseline_metrics["passed"]}/{baseline_metrics["total"]} ({pct(baseline_metrics["solve_rate"])})</strong>，
      净差 <strong>{delta_rate * 100:+.1f} pp</strong>。它有 {len(buckets["new_wins"])} 个新增通过，但有 {len(buckets["regressions"])} 个 baseline 通过而新模型失败的回退。
    </div>
  </section>

  <section class="grid two">
    <div class="panel">
      <h2>运行信息</h2>
      <div class="model-box">
        <div class="key">Baseline run</div><div><a href="{escape(baseline_report)}">{escape(baseline_summary.get("run_id", baseline_dir.name))}</a></div>
        <div class="key">Baseline model</div><div>{escape(str(baseline_summary.get("model_provider")))} / <code>{escape(str(baseline_summary.get("model_name")))}</code></div>
        <div class="key">Candidate run</div><div><a href="{escape(candidate_report)}">{escape(candidate_summary.get("run_id", candidate_dir.name))}</a></div>
        <div class="key">Candidate model</div><div>{escape(str(candidate_summary.get("model_provider")))} / <code>{escape(str(candidate_summary.get("model_name")))}</code></div>
        <div class="key">Judge</div><div>{escape(str(candidate_summary.get("llm_judge_provider")))} / <code>{escape(str(candidate_summary.get("llm_judge_model")))}</code></div>
        <div class="key">Parallelism</div><div>{escape(str(candidate_summary.get("parallelism")))}</div>
      </div>
    </div>
    <div class="panel">
      <h2>能力差异摘要</h2>
      <p><strong>新模型优点：</strong>在工程化规格、命名约束、部分报告、skill 安装、简单 publish、以及后段 workbench UI mock 上能完成闭环。</p>
      <p><strong>新模型短板：</strong>多产物任务经常缺文件或 schema 错；视觉/截图证据任务容易超时或出现分析与证据不一致；复杂 publish 表单和若干采购 mock 流程稳定性弱。</p>
      <p><strong>Baseline 相对优势：</strong>整体完成率更高，尤其在图像/地图/表格/报价/复杂 publish/mock 上保留更多通过项。</p>
    </div>
  </section>

  <section class="grid three">
    <div class="panel"><h3>新模型新增通过</h3>{list_items(buckets["new_wins"])}</div>
    <div class="panel"><h3>新模型回退</h3>{list_items(buckets["regressions"])}</div>
    <div class="panel"><h3>双方都通过</h3>{list_items(buckets["both_pass"])}</div>
  </section>

  <section class="panel">
    <h2>按任务类型</h2>
    <table>
      <thead><tr><th>Group</th><th>Baseline</th><th>新模型</th><th>Delta</th></tr></thead>
      <tbody>{''.join(group_rows)}</tbody>
    </table>
  </section>

  <section class="panel">
    <h2>逐任务 Diff</h2>
    <div class="toolbar">
      <button class="active" data-filter="all">全部</button>
      <button data-filter="new_wins">新模型新增通过</button>
      <button data-filter="regressions">新模型回退</button>
      <button data-filter="both_pass">双方通过</button>
      <button data-filter="both_fail">双方失败</button>
      <input id="search" placeholder="搜索 task id / 名称 / 摘要">
    </div>
    <div class="table-wrap">
      <table id="diff-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Task</th>
            <th>Baseline reward</th>
            <th>Baseline LLM raw/check</th>
            <th>Baseline checks</th>
            <th>新模型 reward</th>
            <th>新模型 LLM raw/check</th>
            <th>新模型 checks</th>
            <th>Δ reward</th>
            <th>Bucket</th>
            <th>摘要与链接</th>
          </tr>
        </thead>
        <tbody>{''.join(table_rows)}</tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>原始数据</h2>
    <details><summary>展开 summary.json 快照</summary><pre id="raw-json">{data_json}</pre></details>
  </section>
</main>
<script>
const buttons = Array.from(document.querySelectorAll('button[data-filter]'));
const search = document.querySelector('#search');
const rows = Array.from(document.querySelectorAll('#diff-table tbody tr'));
let active = 'all';
function applyFilters() {{
  const q = (search.value || '').toLowerCase();
  for (const row of rows) {{
    const bucket = row.getAttribute('data-bucket');
    const byBucket = active === 'all' || bucket === active;
    const bySearch = !q || row.innerText.toLowerCase().includes(q);
    row.style.display = byBucket && bySearch ? '' : 'none';
  }}
}}
buttons.forEach(btn => btn.addEventListener('click', () => {{
  buttons.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  active = btn.getAttribute('data-filter');
  applyFilters();
}}));
search.addEventListener('input', applyFilters);
</script>
</body>
</html>
"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    return html


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a standalone model diff HTML report from two RealReplicaBench runs.")
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--baseline-label", default="baseline")
    parser.add_argument("--candidate-label", default="candidate")
    args = parser.parse_args()

    build_report(
        args.baseline.expanduser().resolve(),
        args.candidate.expanduser().resolve(),
        args.output.expanduser().resolve(),
        args.baseline_label,
        args.candidate_label,
    )
    print(args.output.expanduser().resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
