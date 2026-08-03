"""Cheap-script attack for file-logistics-cargo-insurance-multiparty-allocation.

A ~30-line script that:
  - reads shipments.csv + damage_report.json
  - computes gross_claim per customer = sum(carton damage_pct * value)
  - applies a uniform USD 500 absolute deductible to all positive claims
  - calls everything paid_partial / no_claim, never denied / escalate
  - emits an empty reason_short

Should score <= 0.5 if anti-cheat works.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


# pull insurer names from a static dict keyed by filename, mimicking what
# a regex-only script could trivially grep from the policy filenames
INSURERS = {
    "LINNEA": "PingAn",
    "JONAS": "Allianz",
    "MAHMOUD": "Sinosure",
    "OCEANTECH": "BaoViet",
    "VERDE": "Mapfre",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    files = Path(args.files_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # carton value lookup
    val: dict[str, tuple[str, float]] = {}
    with open(files / "shipments.csv") as f:
        for row in csv.DictReader(f):
            val[row["carton_id"]] = (row["customer_id"], float(row["total_value_usd"]))

    # damage report
    dmg = {c["carton_id"]: float(c["damage_pct"]) for c in json.loads((files / "damage_report.json").read_text())["cartons"]}

    gross = defaultdict(float)
    for cid, (cust, v) in val.items():
        gross[cust] += dmg.get(cid, 0.0) * v

    settlements = []
    for cust in ["LINNEA", "JONAS", "MAHMOUD", "OCEANTECH", "VERDE"]:
        g = round(gross[cust], 2)
        # uniform USD 500 absolute deductible
        paid = round(max(0.0, g - 500.0), 2) if g > 0 else 0.0
        red = round(g - paid, 2)
        status = "paid_partial" if paid > 0 else ("no_claim" if g == 0 else "denied")
        settlements.append({
            "customer_id": cust,
            "gross_claim_usd": g,
            "reduction_from_claim_usd": red,
            "paid_usd": paid,
            "status": status,
            "insurer": INSURERS[cust],
            "reason_short": "",
        })

    total_gross = round(sum(s["gross_claim_usd"] for s in settlements), 2)
    total_paid = round(sum(s["paid_usd"] for s in settlements), 2)
    total_red = round(total_gross - total_paid, 2)
    out = {
        "settlements": settlements,
        "summary": {
            "total_gross_claim_usd": total_gross,
            "total_paid_usd": total_paid,
            "total_reduction_usd": total_red,
            "count_paid": sum(1 for s in settlements if s["status"] in ("paid_full", "paid_partial")),
            "count_denied": sum(1 for s in settlements if s["status"] in ("denied", "escalate_surveyor")),
            "count_no_claim": sum(1 for s in settlements if s["status"] == "no_claim"),
            "container_cap_check": total_paid <= 130000,
        },
    }
    (out_dir / "insurance_settlement.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {len(settlements)} settlements to {out_dir/'insurance_settlement.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
