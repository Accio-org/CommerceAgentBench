# Q4 Portfolio Rebalance — Workspace

This is the analysis workspace Sarah was working in for the upcoming Q2/Q3/Q4
rebalance review.

## Status

Sarah started the analysis last Monday, finished Q2 and Q3 cells, drafted Q4,
then went on PTO Thursday. See `handoff.md` for her notes to whoever picks
this up.

## Layout

- `handoff.md` — Sarah's notes for whoever takes over
- `slack_excerpt.txt` — relevant Slack conversation w/ the PM
- `analysis/qoq.py` — her QoQ computation script (reads from the trend API)
- `analysis/results.csv` — what `qoq.py` printed when she last ran it
- `drafts/draft_rebalance.md` — her draft of the final rebalance memo

## The trend API

Local mock at `http://127.0.0.1:4500/api`. Hit `/api/help` to discover
endpoints. `qoq.py` already wires up the dataset IDs.

## Your task

See the parent `task.md`. Deliverable lives in `outputs/rebalance.json`.
