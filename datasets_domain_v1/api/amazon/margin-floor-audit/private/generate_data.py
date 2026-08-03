#!/usr/bin/env python3
"""Synchronize static assets for the Amazon SP-API workflow task.

The heavy Amazon mock seed is intentionally static in mock_runtime/amazon_seed.json.
It includes Listings Items `offers` values that are stale or from another offer
surface for the approval SKUs; correct agents must validate against
`attributes.purchasable_offer`. This script regenerates the small
author-controlled task input and expected answer for the current API-workflow
contract. API usage is discoverable from the mock's /api/help endpoint rather
than a task-local workflow playbook.
"""

import csv
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
TASK = HERE.parent
WORKSPACE = TASK / "workspace"

SELLER_ID = "A2BENCH00001"
US_MARKETPLACE = "ATVPDKIKX0DER"
REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"
FEED_TYPE = "JSON_LISTINGS_FEED"
FEED_CONTENT_TYPE = "application/json"

APPROVAL_ROWS = [
    ["AXL-2614-4PT", "24.58", "26.19", "PATCH", "APR-2026-0519-03", "pricing approval queue row"],
    ["HUB-8580-7PT", "32.60", "34.49", "FEED", "APR-2026-0519-04", "pricing approval queue row"],
    ["NMB-7202-45W", "33.65", "35.79", "PATCH", "APR-2026-0519-02", "pricing approval queue row"],
    ["VTX-1270-MINI", "26.71", "28.49", "FEED", "APR-2026-0519-01", "pricing approval queue row"],
    ["VTX-6212-NVY", "18.98", "20.29", "FEED", "APR-2026-0519-06", "pricing approval queue row"],
    ["ZPH-8176-XL", "17.34", "18.59", "FEED", "APR-2026-0519-05", "pricing approval queue row"],
    ["GRP-2897-V2", "25.00", "27.19", "FEED", "APR-2026-0519-07", "pricing approval queue row"],
    ["KLP-3296-BLK", "34.41", "36.99", "PATCH", "APR-2026-0519-08", "pricing approval queue row"],
    ["RGN-5470-MINI", "24.99", "26.49", "FEED", "APR-2026-0519-09", "pricing approval queue row"],
]

PATCH_UPDATES = [
    {"sku": "AXL-2614-4PT", "new_price": 26.19},
    {"sku": "NMB-7202-45W", "new_price": 35.79},
]

FEED_UPDATES = [
    {"sku": "HUB-8580-7PT", "new_price": 34.49},
    {"sku": "VTX-1270-MINI", "new_price": 28.49},
    {"sku": "VTX-6212-NVY", "new_price": 20.29},
    {"sku": "ZPH-8176-XL", "new_price": 18.59},
]

SKIPPED_UPDATES = {
    "GRP-2897-V2": "stale",
    "KLP-3296-BLK": "not_buyable",
    "RGN-5470-MINI": "not_in_us",
}

def write_approvals():
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    path = WORKSPACE / "approved_price_updates.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["sku", "expected_current_price", "new_price", "publication_channel", "approval_id", "note"])
        writer.writerows(APPROVAL_ROWS)


def write_expected():
    expected = {
        "seller_id": SELLER_ID,
        "marketplace_id": US_MARKETPLACE,
        "report_type": REPORT_TYPE,
        "feed_type": FEED_TYPE,
        "feed_content_type": FEED_CONTENT_TYPE,
        "patch_updates": PATCH_UPDATES,
        "feed_updates": FEED_UPDATES,
        "skipped_updates": SKIPPED_UPDATES,
    }
    (HERE / "expected_answer.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")


def main():
    write_approvals()
    write_expected()
    print("Synchronized Amazon SP-API workflow task assets.")


if __name__ == "__main__":
    main()
