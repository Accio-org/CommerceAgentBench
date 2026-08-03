"""Quarterly QoQ growth for the portfolio rebalance.

Reads multi_brand TIMESERIES from the local trend API mock, splits each
series into 4 consecutive quarters of ~13 weeks, averages per brand per
quarter, then computes QoQ growth for the brand occupying each slot at the
start of Q2/Q3/Q4.

Output: analysis/results.csv
"""
from __future__ import annotations

import csv
import json
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:4500/api"

CATEGORIES = {
    "earbuds": "set_earbuds",
    "drill":   "set_drill",
    "speaker": "set_speaker",
}

STARTING = {
    "Q2": {"earbuds": "jbl live",                  "drill": "ryobi",     "speaker": "homepod mini"},
    "Q3": {"earbuds": "jabra elite",               "drill": "milwaukee", "speaker": "homepod mini"},
    "Q4": {"earbuds": "bose quietcomfort earbuds", "drill": "milwaukee", "speaker": "homepod mini"},
}


def fetch(ds_id: str) -> dict:
    with urllib.request.urlopen(f"{BASE}/datasets/{ds_id}") as r:
        return json.loads(r.read())


def quarter_averages(ds: dict) -> dict[str, dict[str, float]]:
    """Return {Q1: {brand: avg, ...}, Q2: ..., Q3: ..., Q4: ...}."""
    weeks = ds["interest_over_time"]["timeline_data"]
    # 52-week window split into 4 quarters.
    q1 = weeks[0:14]
    q2 = weeks[14:27]
    q3 = weeks[27:40]
    q4 = weeks[40:52]
    out: dict[str, dict[str, float]] = {}
    for qname, qweeks in [("Q1", q1), ("Q2", q2), ("Q3", q3), ("Q4", q4)]:
        brand_vals: dict[str, list[int]] = {}
        for w in qweeks:
            for v in w["values"]:
                brand_vals.setdefault(v["query"].lower(), []).append(v["extracted_value"])
        out[qname] = {b: sum(vs) / len(vs) for b, vs in brand_vals.items()}
    return out


def qoq_growth(avgs: dict[str, dict[str, float]], q: str, brand: str) -> float:
    prev_q = {"Q2": "Q1", "Q3": "Q2", "Q4": "Q3"}[q]
    cur = avgs[q].get(brand, 0.0)
    prev = avgs[prev_q].get(brand, 0.0)
    return (cur - prev) / max(prev, 0.01)


def decide(qoq: float, qn_avgs: dict[str, float], current_brand: str) -> str:
    if qoq >= 0.05:
        return "keep"
    if -0.05 <= qoq < 0.05:
        return "hold_watch"
    # swap_out — pick highest Qn avg among the OTHER brands
    others = {b: v for b, v in qn_avgs.items() if b != current_brand}
    if not others:
        return "swap_out"
    target = max(others, key=lambda b: (others[b], -ord(b[0])))
    return f"swap_in:{target}"


def main() -> None:
    avgs = {cat: quarter_averages(fetch(ds_id)) for cat, ds_id in CATEGORIES.items()}
    rows = []
    for q in ["Q2", "Q3", "Q4"]:
        for slot in ["earbuds", "drill", "speaker"]:
            brand = STARTING[q][slot]
            g = qoq_growth(avgs[slot], q, brand)
            a = decide(g, avgs[slot][q], brand)
            rows.append({
                "quarter": q, "slot": slot, "starting_brand": brand,
                "qoq_growth": round(g, 4), "action": a,
            })
    out = Path(__file__).parent / "results.csv"
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["quarter","slot","starting_brand","qoq_growth","action"])
        w.writeheader(); w.writerows(rows)
    print(f"wrote {out} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
