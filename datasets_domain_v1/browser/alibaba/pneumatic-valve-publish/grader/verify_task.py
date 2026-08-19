"""v2 verifier — thin wrapper over shared alibaba_publish_v2."""
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
    ap.add_argument("--mock-url", default=os.environ.get("MOCK_SITE_URL", "http://127.0.0.1:3000"))
    ap.add_argument("--mode", choices=["browser", "cli"], default="browser")
    args = ap.parse_args()

    import bench_core.verifiers.alibaba_publish_v2 as ap_v2

    ap_v2.verify(
        task_dir=Path(args.task_dir),
        output_dir=Path(args.output_dir),
        reward_json=Path(args.reward_json),
        mock_url=args.mock_url,
        mode=args.mode,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
