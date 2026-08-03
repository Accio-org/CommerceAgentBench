We're shipping a new BI dashboard that ingests a flat CSV of weekly trend interest scores, and I need you to produce that CSV from the trend snapshots and hand it to the BI pipeline before the dashboard goes live.

The BI team sent over `workspace/bi_reference_sample.csv` — a short (~12-row) sample of the output shape they expect. Treat it as a formatting hint only: the field spec below is what the pipeline actually validates against, and the snapshots are the source of truth for every value (don't match the sample's row set or drop anything to look like it).

The snapshots are in `workspace/snapshots/`. For this CSV, the in-scope snapshots are exactly the baseline Google Shopping 12-month time-series datasets with these ids: `set_airfryer`, `set_earbuds`, `set_speaker`, `set_vacuum`, `set_coffee`, `set_drill`, `set_mattress`, and `set_headset`. Use `workspace/snapshots/manifest.json` as metadata to confirm those ids and their source parameters. Do NOT include out-of-scope companion snapshots such as `*_web`, `*_2024`, `geomap_*`, `season_*`, `dma_*`, or `edge_empty` — they're in the folder for other audit workflows and aren't part of this CSV.

Write `outputs/trends_flat.csv` with **exactly** this header, in this order:

```
week_iso,slug,brand,value,partial_data
```

Field rules:

| Column | Type | Format |
|---|---|---|
| `week_iso` | string | ISO 8601 date `YYYY-MM-DD`, derived from the entry's `timestamp` (epoch seconds → UTC date). Example: `1747526400` → `2025-05-18`. |
| `slug` | string | Category slug (e.g. `airfryer`, `earbuds`). Equal to the dataset id with `set_` prefix removed. Lowercase. |
| `brand` | string | The brand string from `values[].query`, lowercase exactly as it appears in the JSON (preserve spaces, e.g. `ninja air fryer`). |
| `value` | integer | The `extracted_value` (integer 0-100). |
| `partial_data` | integer | `1` if the entry has `partial_data: true`, else `0`. |

Include **every** weekly entry from each of the eight in-scope snapshots above, including any entry flagged `partial_data: true` (with its `partial_data` column set to `1`). Do not drop rows. Sort rows lexicographically by `(slug, brand, week_iso)`. CSV serialization: comma delimiter, no quoting unless a field contains a comma.
