"""Thin wrapper — actual verifier lives in real_replica_bench.verifiers.shopify_online_store_v2."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    ap.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", os.environ.get("MOCK_URL", "")))
    args = ap.parse_args()

    from real_replica_bench.verifiers import shopify_online_store_v2 as v

    v.verify(
        task_dir=Path(args.task_dir),
        output_dir=Path(args.output_dir),
        reward_json=Path(args.reward_json),
        mock_url=args.mock_url,
        verifier_token=os.environ.get("MOCK_VERIFIER_TOKEN", ""),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
