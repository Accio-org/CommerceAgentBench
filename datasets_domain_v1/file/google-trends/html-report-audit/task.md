I'm a senior analyst reviewing a junior colleague's HTML sourcing dashboard before it goes to the VP. The brief makes specific quantitative claims about Google Trends data across several commerce categories (drill, earbuds, coffee, speaker, vacuum, mattress), and some of those claims are wrong. I need you to find every wrong claim, classify it by error type, locate it by section, and give the correct value.

The report is `workspace/analyst_report.html` — a multi-section HTML dashboard styled like a real analytics report. It has inline tables, collapsible `<details>` sections, two embedded chart images at `workspace/charts/*.png`, an `<aside id="appendix">` at the bottom with reference tables, and footnote markers linked via `<a href="#…">` to detailed appendix entries. Some sections embed raw weekly data inside `<script type="application/json" id="…">…</script>` blocks (machine-readable; the visible text in those sections is supposedly derived from that JSON). To audit thoroughly you may need to parse the HTML structurally, open the embedded PNG charts and read their bars visually, decode the embedded JSON blocks, and follow the footnote/appendix references.

You have full access to the trend snapshot collection for most categories (see the data-source note below) — the same data the junior analyst should have used. One exception: the raw trend data for the **earbuds** and **mattress** categories is NOT in the snapshot collection. For those two, the only source of truth available to you is the leaderboard chart PNG (`workspace/charts/earbuds_leaderboard.png` and `workspace/charts/mattress_leaderboard.png`) — you have to read the bars/labels visually to verify any ranking claim about earbuds or mattress brands.

The error types are:

| `error_type` (enum) | Meaning |
|---|---|
| `arithmetic_error` | A specific number is wrong (off by something more than rounding) |
| `channel_confusion` | A claim cites the shopping channel but the displayed value actually matches the web channel (or vice versa) |
| `rank_error` | A brand ranking is wrong (wrong #1, wrong order, wrong leader) |
| `regional_count_error` | A claim about how many regions/states a brand leads is wrong |
| `partial_data_unfiltered` | A computed aggregate includes the `partial_data:true` week that should have been filtered out |

Each error appears in exactly one `section` of the HTML (sections have `id` attributes — use those IDs verbatim). Not every suspicious-looking claim is an error: some unusual claims turn out correct once you reconcile the HTML, embedded data, appendix, and charts. Your `findings` list should contain only claims you can support as genuinely wrong — avoid both over-reporting correct claims and missing real errors.

Write `outputs/audit_findings.json`:

```json
{
  "findings": [
    {
      "finding_id": 1,
      "error_type": "<one of the 5 enum values above>",
      "section_id": "<the section's id attribute, e.g. 'exec-summary'>",
      "claim_excerpt": "<short quote from the HTML of the wrong claim — for traceability>",
      "correct_value": "<see below for type>"
    },
    {"finding_id": 2, "...": "..."}
  ]
}
```

Each entry's `correct_value` type depends on the error: for `arithmetic_error`, `regional_count_error`, `partial_data_unfiltered`, and `channel_confusion` it's the correct numeric value; for `rank_error` it's the correct brand string (verbatim from the data, lowercase). `finding_id` is informational (any unique integer) — use `error_type` and `section_id` to identify the audited claim clearly.

Tolerances: `section_id` is an exact lowercase string match against the HTML `id`; `error_type` is an exact enum match (case-insensitive); numeric `correct_value` is checked within a per-error tolerance (typically ±0.5 to ±1.0); and `rank_error` strings match case-insensitively and whitespace-trimmed.

Data source: 34 snapshot files at `workspace/snapshots/` with a `manifest.json` — filter by `type`, `channel`, `date_range`, and (for multi-brand) the query list to find the data behind each section. The manifest intentionally does not list `set_earbuds*` or `set_mattress*` (see the earbuds/mattress exception above).
