"""Trend-snapshot data-quality audit.

Walks the snapshot catalog (via the local trend API mock) and emits the four
issue classes the downstream analysts asked for:

  1. in-progress (partial_data) weeks
  2. empty-query datasets
  3. sub-floor brand presence (brand avg < 0.5)
  4. monopoly categories (leader_share > 0.65)

Output: analysis/results.json
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:4500/api"

SUB_FLOOR = 0.5
MONOPOLY_SHARE = 0.65
# A dataset is treated as effectively empty if a clear majority of its brands
# never register — same threshold we used on the Q3 catalog sweep.
EMPTY_ZERO_FRACTION = 0.6


def fetch(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}") as r:
        return json.loads(r.read())


def list_datasets() -> list[dict]:
    return fetch("/datasets")["datasets"]


def in_scope(ds: dict) -> bool:
    """Multi-brand shopping timeseries — the sets the competitive lens cares about."""
    return ds.get("type") == "multi_brand_timeseries" and ds.get("channel") == "shopping"


def brand_avgs(payload: dict) -> dict[str, float]:
    iot = payload.get("interest_over_time")
    if not iot:
        return {}
    weeks = [w for w in iot["timeline_data"] if not w.get("partial_data")]
    bv: dict[str, list[int]] = {}
    for w in weeks:
        for v in w["values"]:
            bv.setdefault(v["query"].strip().lower(), []).append(v["extracted_value"])
    return {b: sum(vs) / len(vs) for b, vs in bv.items()}


def main() -> None:
    catalog = list_datasets()
    scope = [d for d in catalog if in_scope(d)]

    # --- 1. partial_data weeks (in-scope) ---
    partial = []
    for d in scope:
        payload = fetch(f"/datasets/{d['id']}")
        iot = payload.get("interest_over_time")
        if not iot:
            continue
        cnt = sum(1 for w in iot["timeline_data"] if w.get("partial_data"))
        if cnt > 0:
            partial.append({"dataset_id": d["id"], "partial_data_week_count": cnt})

    # --- 2. empty-query datasets (whole catalog) ---
    empty = []
    for d in catalog:
        payload = fetch(f"/datasets/{d['id']}")
        if "error" in payload:
            empty.append(d["id"])
            continue
        if not d.get("type", "").endswith("timeseries"):
            continue
        avgs = brand_avgs(payload)
        if not avgs:
            empty.append(d["id"])
            continue
        zero_frac = sum(1 for v in avgs.values() if v == 0) / len(avgs)
        if zero_frac >= EMPTY_ZERO_FRACTION:
            empty.append(d["id"])

    # --- 3. sub-floor brand presence (in-scope) ---
    sub_floor = []
    for d in scope:
        avgs = brand_avgs(fetch(f"/datasets/{d['id']}"))
        for b, v in avgs.items():
            if v < SUB_FLOOR:
                sub_floor.append({"slug": d["category"], "brand": b, "twelve_month_avg": round(v, 2)})

    # --- 4. monopoly categories (in-scope) ---
    monopoly = []
    for d in scope:
        avgs = brand_avgs(fetch(f"/datasets/{d['id']}"))
        if not avgs:
            continue
        total = sum(avgs.values()) or 0.01
        leader = max(avgs, key=lambda b: avgs[b])
        share = avgs[leader] / total
        if share > MONOPOLY_SHARE:
            monopoly.append({"slug": d["category"], "leader": leader, "leader_share": round(share, 2)})

    out = {
        "partial_data_datasets": partial,
        "empty_query_datasets": empty,
        "sub_floor_brand_presences": sub_floor,
        "monopoly_datasets": monopoly,
    }
    out_path = Path(__file__).parent / "results.json"
    out_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out_path}: {len(partial)} partial, {len(empty)} empty, "
          f"{len(sub_floor)} sub-floor, {len(monopoly)} monopoly")


if __name__ == "__main__":
    main()
