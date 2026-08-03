You've got an already-logged-in browser session for a cross-border-commerce forum at `http://localhost:3001`. The page at `/session/source` is that logged-in session — reuse its cookies to reach the protected content. Don't go to the public internet or use any real Reddit account; everything you need is on this forum.

Find the user **QualityFirst_QC** in **r/CrossBorderCommerce** and read their posts. Then fill out the structured answer file below with the facts you extracted.

## Deliverable

Write **`outputs/answer.json`** with **exactly** this shape (the values after `e.g.` are just format samples, not the real answers — read the real facts off the forum):

```json
{
  "primary_session_cookie": "<string: one of the session cookie name=value pairs you reused from /session/source, copied verbatim; e.g. 'reddit_session=abc123...'>",
  "target_username": "<string: the target user's handle, case-insensitive match, without 'u/' prefix; e.g. 'exampleuser'>",
  "target_subreddit": "<string: the subreddit name, case-insensitive match, without 'r/' prefix; e.g. 'ExampleSubreddit'>",
  "ppwr_effective_date": "<string: YYYY-MM-DD ISO date when EU PPWR takes effect; e.g. '2026-01-01'>",
  "ppwr_recycled_content_min_pct": <integer: minimum recycled content percentage for plastic packaging; e.g. 30>,
  "ppwr_empty_space_max_pct": <integer: maximum empty-space percentage in shipping boxes; e.g. 50>,
  "ppwr_dpp_required": <boolean: is Digital Product Passport with QR code required on packaging?; e.g. true>,
  "ppwr_epr_per_country_required": <boolean: must you register EPR in each EU country?; e.g. false>,
  "ppwr_penalty_max_eur": <integer: maximum penalty per violation in euros; e.g. 50000>,
  "ppwr_penalty_max_revenue_pct": <integer: maximum penalty as percent of annual EU turnover; e.g. 3>,
  "inspection_total_cost_usd": <integer: total inspection cost the user reports in USD; e.g. 5000>,
  "inspection_orders_count": <integer: total orders inspected in the reporting year; e.g. 30>,
  "inspection_savings_usd": <integer: dollars saved via inspections, approximate but as stated; e.g. 80000>,
  "inspection_roi_multiplier": <number: stated ROI multiplier, decimal; e.g. 10.0>,
  "aql_critical": <number: AQL value for critical defects; e.g. 0>,
  "aql_major": <number: AQL value for major defects; e.g. 2.0>,
  "aql_minor": <number: AQL value for minor defects; e.g. 3.5>,
  "inspection_stages": [
    "<string: each stage name from the enum; e.g. 'pre-production'>"
  ],
  "third_party_threshold_usd": <integer: USD order threshold above which user recommends third-party inspectors like QIMA/V-Trust; e.g. 3000>,
  "freelance_inspector_min_day_rate_usd": <integer: low end of freelance inspector day rate in USD; e.g. 150>,
  "freelance_inspector_max_day_rate_usd": <integer: high end of freelance inspector day rate in USD; e.g. 220>
}
```

## Field constraints

- **All fields are required**. Use `null` only if you genuinely cannot find the information.
- `primary_session_cookie`: the literal `name=value` string (e.g. `reddit_session=abc...`), not a description.
- `target_username` / `target_subreddit`: case-insensitive, no `u/` or `r/` prefix.
- `ppwr_effective_date`: strictly `YYYY-MM-DD` (e.g. `2026-07-01`). No other formats.
- Numeric fields: bare numbers, no units, no `"%"`, no `"$"`. e.g. `35`, `0.0`, `15.4`.
- `inspection_stages`: list of strings, choose from the enum `["pre-production", "during-production", "pre-shipment"]`. Any item outside this enum is ignored.
- `inspection_roi_multiplier`: decimal as stated by the user (e.g. `15.4`).
- AQL values: decimal as stated (e.g. `0`, `2.5`, `4.0`).

## Working directory

- Outputs go in `/task/outputs/answer.json`
- `outputs/` should contain only this one file. No drafts, no logs, no temp.
