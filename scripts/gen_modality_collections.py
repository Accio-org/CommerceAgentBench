#!/usr/bin/env python3
"""Generate modality-split collections for domain_v1 from each task.toml's
`[environment].requires_vision` / `requires_browser` flags.

Outputs (next to the canonical _all collection):
  - realreplicabench_domain_v1_text_only.collection.json
      requires_vision == false AND requires_browser == false
      → guaranteed safe for non-multimodal models (no image to interpret AND no
        browser perception dependency).
  - realreplicabench_domain_v1_vision.collection.json
      requires_vision == true
  - realreplicabench_domain_v1_browser_textcapable.collection.json
      requires_vision == false AND requires_browser == true
      → browser tasks whose CONTENT needs no vision; candidates to fold into
        text_only IF an empirical smoke shows the harness exposes enough non-visual
        state for a text-only model to drive the browser. Kept separate until then.

Re-run after changing any requires_vision flag. Reusable (no campaign coupling).

Usage:  python3 scripts/gen_modality_collections.py [--write]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets_domain_v1"
ALL_COLLECTION = DATASETS / "realreplicabench_domain_v1_all.collection.json"


def main() -> None:
    write = "--write" in sys.argv
    text_only, vision, browser_tc = [], [], []
    total = 0
    for toml_path in sorted(DATASETS.rglob("task.toml")):
        total += 1
        data = tomllib.loads(toml_path.read_text())
        tid = (data.get("task") or {}).get("id") or toml_path.parent.name
        env = data.get("environment") or {}
        rv = bool(env.get("requires_vision", False))
        rb = bool(env.get("requires_browser", False))
        if rv:
            vision.append(tid)
        elif rb:
            browser_tc.append(tid)
        else:
            text_only.append(tid)

    for lst in (text_only, vision, browser_tc):
        lst.sort()

    # sanity vs the canonical _all collection
    all_ids = set(json.loads(ALL_COLLECTION.read_text()).get("task_ids") or [])
    derived = set(text_only) | set(vision) | set(browser_tc)
    if all_ids and derived != all_ids:
        miss = all_ids - derived
        extra = derived - all_ids
        print(f"WARN: derived set != _all collection. missing={sorted(miss)} extra={sorted(extra)}",
              file=sys.stderr)

    specs = [
        ("text_only", text_only,
         "Text-capable subset: no image to interpret AND no browser perception "
         "dependency. Runnable by non-multimodal models."),
        ("vision", vision,
         "Vision-required tasks: success needs interpreting an image or visual-only UI state."),
        ("browser_textcapable", browser_tc,
         "Browser tasks whose content needs no vision; candidates for text_only pending "
         "an empirical non-vision-model browser smoke."),
    ]
    print(f"total tasks: {total}")
    for name, ids, desc in specs:
        out = DATASETS / f"realreplicabench_domain_v1_{name}.collection.json"
        payload = {
            "collection_id": f"realreplicabench_domain_v1_{name}",
            "description": desc,
            "task_ids": ids,
        }
        print(f"  {name:20s} {len(ids):3d}  -> {out.name}")
        if write:
            out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    if not write:
        print("(dry-run; pass --write to emit files)")


if __name__ == "__main__":
    main()
