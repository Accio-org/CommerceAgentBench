# Quarterly Portfolio Rebalance — Final Draft

_Author: Sarah    Status: FINAL — needs JSON conversion only_

## TL;DR

3 slots × 3 decision quarters = 9 cells. Methodology in `analysis/qoq.py`,
raw numbers in `analysis/results.csv`. Decisions below pull from `results.csv`
with minor brand-name cleanup.

## Q2 decisions

| Slot    | Starting brand | qoq_growth | Action                       |
|---------|----------------|------------|------------------------------|
| earbuds | jbl live       | -1.0000    | swap_in:beats studio buds    |
| drill   | ryobi          | -0.2731    | swap_in:milwaukee            |
| speaker | homepod mini   |  0.0000    | hold_watch                   |

## Q3 decisions

| Slot    | Starting brand                | qoq_growth | Action          |
|---------|-------------------------------|------------|-----------------|
| earbuds | jabra elite                   | -1.0000    | swap_in:bose quietcomfort earbuds |
| drill   | milwaukee                     | -0.0850    | swap_in:dewalt  |
| speaker | homepod mini                  |  0.0000    | hold_watch      |

## Q4 decisions

| Slot    | Starting brand                | qoq_growth | Action |
|---------|-------------------------------|------------|--------|
| earbuds | bose quietcomfort earbuds     | 60.1481    | keep   |
| drill   | milwaukee                     |  0.9332    | keep   |
| speaker | homepod mini                  | 1466.6667  | keep   |

## Next step

Convert the table above into `outputs/rebalance.json` per the shape in
`task.md`. All 9 cells are filled in.
