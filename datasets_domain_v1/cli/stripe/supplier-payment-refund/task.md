Li Wei's QA team finished the June inspection cycle — results are in `workspace/`. Process all the refunds through Stripe and close out the batch. The charges are already in the system, just `stripe charges list` to see them.

Our standard refund policies (for reference):

- Defective units → proportional credit based on defect count × per-unit cost on the original charge
- Full batch rejection or duplicate billing → full refund of the original charge
- SLA late delivery → $220/day penalty starting from day 8 of delay
- Overcharged storage → proportional credit for unused days
- Damage in transit with supplier agreement to replace → full refund
- Defects within contractual tolerance (≤1% on standard lots) → no credit
