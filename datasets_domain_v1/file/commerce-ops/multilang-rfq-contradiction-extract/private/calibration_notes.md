# Calibration notes — file-commerce-ops-multilang-rfq-contradiction-extract

## Self-review gates

| Gate | Result | Notes |
|---|---|---|
| 1. Golden answer scores 1.0 | ✅ 39/39 | `private/golden_outputs/rfq_analysis.json` runs through verifier to score=1.0 |
| 2. Cheap script ≤ 0.5 | ✅ 0.4615 (18/39) | `private/_cheap_attack.py` regex-only attack passes structural (3) + language (5) + quantity (5) + incoterm (5). Fails all 20 contradiction-related checks (0/20). |
| 3. Positive framing | ✅ | grep for fraud/scam/cheat/deceive/violate/abuse/illegal — only false-positive matches on the word "cheatsheet" in the agent-visible reference doc |
| 4. Dry-run empty outputs | ✅ 0/39 | Verifier doesn't crash, emits valid reward.json |

## Expected real-model differentiation

- **gemini-3-flash** target: pass the 18 easy checks (structural + field extraction) reliably. Contradiction detection is the differentiator. Realistic per-contradiction pass:
  - RFQ-01 (physical_impossibility, sea 10d CN→MX) — requires reading reference doc transit table; medium difficulty
  - RFQ-02 (incoterm_conflict, FOB+Berlin obligations) — requires Incoterms knowledge; medium-hard
  - RFQ-03 (cost_infeasible, $0.12 + full cert) — requires BOM intuition or reading reference; medium
  - RFQ-04 (logical_conflict, 100u + 40HQ + air) — requires container-volume sense; medium
  - RFQ-05 (timeline_conflict, Easter math) — requires multi-step date arithmetic; medium-hard
  - Expected flash hit rate: 2-3 / 5 contradictions (4 checks each = 8-12 passes out of 20)
  - Flash projected total: ~18 + ~10 = 28/39 = 72% (binary fail at ~75% threshold? depends on which atomic checks; the binary all-checks-pass design means flash should miss enough to fail)
- **opus-4.7** target: should catch all 5 contradictions plus correctly cite resolutions
  - Opus projected total: ~35-39/39 = 90-100%
  - Should pass binary

## Differentiation mechanism

The split: 19 / 39 checks (≈ 49%) are easy-extraction (structural + 3 fields × 5 RFQs), 20 / 39 checks (≈ 51%) are pure inconsistency detection + resolution proposing.

- Easy half: any half-decent text model passes
- Hard half: requires (a) reading the sourcing_rules_reference.md cheatsheet, (b) applying its facts to each RFQ, (c) generating both the category label and an actionable resolution

A model that doesn't internalise the reference doc fails the hard half completely. A model that reads the reference but doesn't pattern-match it to each RFQ specifics may catch 1-3 contradictions only.

## Why this passes anti-cheat gate 2

Cheap regex script can never:
1. Compute "10 días sea Shanghai → Manzanillo" violates known transit times (requires lookup)
2. Recognise "FOB Shanghai + risk to Berlin" is an Incoterm conflict (requires Incoterms semantics)
3. Recognise "$0,12 + INMETRO + 100% inspection" is cost-infeasible (requires BOM floor)
4. Recognise "100 units + 40HQ exclusive + air freight" is a shipping spec misconfiguration (requires container/mode knowledge)
5. Compute "PO 22 Mar + 30d prod + 30d transit > 15 April" (requires multi-step date math)

All 5 contradictions × 4 sub-checks (present, category, evidence, resolution) = 20 checks that require domain knowledge + reading the reference doc + applying it. Cheap script hits 0/20.

## Open risks

- **Language-detect false positives**: my LANG_HINTS in the cheap attack might over-fit. A truly cheap script using `langdetect` library could match my LANG_HINTS accuracy → no change in score (already 5/5 for language)
- **RFQ-04 quantity = 100**: a "smart" cheap script might assume Arabic numerals and pick 5000 (the next-batch number). My current cheap_attack uses largest-first heuristic and gets 100 — but with a different regex priority a cheap script could get 0/5 and total drops further. Not a concern.
- **Resolution check**: the keyword list is broad to accept varied phrasing. Risk that opus's resolution doesn't include any keyword. Mitigation: keywords include common verbs (raise, increase, drop, switch, clarify, propose, etc.) — broad enough.
- **Incoterm always FOB**: I made all 5 buyers use FOB. Real-world distribution is more varied. Could swap RFQ-02 to use CIF or RFQ-04 to use EXW for diversity. Trade-off: would also change the contradiction signature for RFQ-02. Leaving as-is for now.

## Recommendation

Submit for user review. If user wants real smoke, this task is ready.
