# Devin's workspace

Start with `handoff.md`. Read order suggestion:

1. `handoff.md` — what this is, methodology, status
2. `slack_excerpt.txt` — relevant Slack thread with the PM
3. `analysis/audit.py` — the audit script (hits the trend API mock)
4. `analysis/results.json` — what `audit.py` wrote on the last run
5. `drafts/draft_audit.md` — Devin's write-up, ready modulo a JSON conversion

## The trend API

Local mock at `http://127.0.0.1:4500/api`. Hit `/api/help` to discover
endpoints; `/api/datasets` lists the catalog and `/api/datasets/<id>` returns
each raw payload. `audit.py` already wires this up.

The draft is "FINAL" per the header, but a final reviewer should still
sanity-check before it leaves the team.
