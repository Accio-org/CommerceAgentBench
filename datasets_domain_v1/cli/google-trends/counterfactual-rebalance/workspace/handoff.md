# Handoff — Sarah → whoever takes the readout to the VP

Going on PTO Thu-Fri, draft is **done** and ready for the VP readout tomorrow.
You just need to convert it to the JSON shape in `task.md` and a sanity-check
before it goes out.

## What this is

Quarterly portfolio decision for 3 rolling slots. We carry one brand per slot
and reconsider each quarter based on shopping-channel demand momentum (QoQ
growth in Google Trends interest).

## Starting brands at each quarter cut

These are the canonical starting brands for each decision cell, already
reflecting the Q1→Q2 and Q2→Q3 swaps we applied based on the prior cells.

| Quarter starts | earbuds                       | drill     | speaker      |
|----------------|-------------------------------|-----------|--------------|
| Q2             | jbl live                      | ryobi     | homepod mini |
| Q3             | jabra elite                   | milwaukee | homepod mini |
| Q4             | bose quietcomfort earbuds     | milwaukee | homepod mini |

Treat each (quarter, slot) as independent — use the brand in the table above
as the `starting_brand` for that cell. No need to maintain portfolio state
across the chain. The verifier matches by (quarter, slot), not by starting
brand, so this is just there so you know which brand each cell is about.

## Methodology

`analysis/qoq.py` pulls the three multi-brand TIMESERIES datasets from the
local trend API (shopping channel, today 12-m window), splits each series
into 4 quarters, averages each brand within each quarter, then computes:

```
qoq_growth = (avg_Qn(brand) - avg_Q(n-1)(brand)) / max(avg_Q(n-1)(brand), 0.01)
```

Decision rule per cell:

- `qoq_growth >= 0.05`            → `keep`
- `-0.05 <= qoq_growth < 0.05`    → `hold_watch`
- `qoq_growth < -0.05`            → `swap_out`, and the next quarter
  starts with the slot occupied by the highest-avg-in-Qn brand among the
  OTHER 4 in the same category. Encode as `swap_in:<brand>`.

## Status

Draft of the readout is in `drafts/draft_rebalance.md`. Numbers in the draft
are what `qoq.py` printed last Mon (see `analysis/results.csv`); I went
through cell by cell and the actions line up with the threshold rule.

Q4 cells look large because most of those slots had near-zero Q3 baselines —
the math just blows up when you divide by ~0.01. Actions are still all
`keep` since growth is unambiguously positive.

## One thing I want to flag

`qoq.py` doesn't explicitly filter `partial_data:true` rows from the
snapshot. I _think_ my quarter slicing already drops the trailing
in-progress week (only 52 of 53 weeks used), so it shouldn't matter. If
your sanity-check turns up something weird, that's the first place I'd
look.

Have fun, sorry for the mess. — Sarah
