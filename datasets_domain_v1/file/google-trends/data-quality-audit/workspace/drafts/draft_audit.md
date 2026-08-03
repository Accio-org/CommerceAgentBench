# Trend Catalog Data-Quality Audit — Draft

_Author: Devin    Status: FINAL — needs JSON conversion only_

## TL;DR

Swept the full snapshot catalog for the four issue classes. Numbers below
come straight from `analysis/results.json` (output of `analysis/audit.py`),
with the headset scope call from the PM's Slack thread folded into Issue 1.

## Issue 1 — In-progress (partial_data) weeks

Every in-scope multi-brand shopping timeseries carries exactly one trailing
in-progress week. The PM said on Slack we're sunsetting the gaming-headset
line and to leave headset off the partial-data items, so I took `set_headset`
out of this table.

| dataset_id    | partial_data_week_count |
|---------------|-------------------------|
| set_airfryer  | 1 |
| set_earbuds   | 1 |
| set_speaker   | 1 |
| set_vacuum    | 1 |
| set_coffee    | 1 |
| set_drill     | 1 |
| set_mattress  | 1 |

## Issue 2 — Empty-query datasets

`audit.py` flags a dataset as effectively empty when an explicit `error`
payload is present OR a clear majority of its brands never register any
shopping interest. That catches `edge_empty` plus the prior-year baselines
where most brands flatlined:

- `edge_empty`
- `set_airfryer_2024`
- `set_earbuds_2024`
- `set_speaker_2024`
- `set_headset_2024`

## Issue 3 — Sub-floor brand presence (avg < 0.5)

23 (slug, brand) pairs fell below the 0.5 floor across the in-scope sets —
full list is in `results.json` under `sub_floor_brand_presences`. The
recurring offenders are `vacuum`/shark navigator and `mattress`/leesa on the
current window, plus the long tail of prior-year zero-interest brands.

## Issue 4 — Monopoly categories (leader_share > 0.65)

Four categories are competitively degenerate (one brand owns >65% of
combined interest):

| slug      | leader          | leader_share |
|-----------|-----------------|-------------:|
| airfryer  | ninja air fryer |         0.76 |
| coffee    | breville        |         0.68 |
| speaker   | sonos era       |         1.00 |
| headset   | astro a40       |         1.00 |

## Next step

Convert into `outputs/quality_audit.json` per the shape in `task.md`. Pull
`partial_data_datasets` / `empty_query_datasets` / `monopoly_datasets` from
the tables above, and `sub_floor_brand_presences` straight from
`results.json`.
