# Expected facts / LLM judge ground truth (file-commerce-ops-hengyan-english-site-build v2)

## Subject

Hebei Hengyan Lifting Machinery Co., Ltd. (HENGYAN brand) — manufacturer of overhead cranes, gantry cranes, hoists, winches, jib cranes, crab trolleys for global B2B buyers.

## Required products (from site_content_brief.json)

All 6 products MUST appear:
- `HY-OHC-20` — Overhead Crane (5-20 ton)
- `HY-GANTRY-32` — Gantry Crane (10-32 ton)
- `HY-EHOIST-5` — Electric Hoist (1-5 ton)
- `HY-WINCH-10` — Winch (3-10 ton)
- `HY-JIB-3` — Jib Crane (0.5-3 ton)
- `HY-CRAB-16` — Crab Trolley (5-16 ton)

## Forbidden claims (anti-cheat)

The local brief explicitly says: do NOT claim CE / ISO / TUV / OSHA / UL or third-party certifications. Do NOT claim exact annual output / founded year / patent count / named customers.

These phrases must NOT appear:
- `CE Certified`
- `ISO Certified`
- `passed EU safety certifications`

## Required interactions

The site must implement:
- Custom cursor follower (mousemove)
- Expandable product cards (hover/click/keyboard)
- Case carousel/switcher
- Product filtering (filter)
- Anchor scroll smoothing
- Mock inquiry form (submit + preventDefault, no real backend)

## Accessibility / responsiveness

- ≥2 @media rules (mobile + desktop breakpoints)
- :focus or focus-visible styles
- Keyboard-accessible interactions (keydown / aria-expanded / keyup)
- Core content visible without JS (progressive enhancement)

## Anti-cheat for fabrication

- Specific certs / customer names / patent numbers without local source = fail
- Any remote URL (http:// or https://) in artifacts = fail (offline only)
- Real backend dependency = fail (must be static + mock)

## What is NOT fabrication

- Using the brand positioning and tone from brand_brief.md
- Faithfully rendering all 6 products with their capacity / buyer_use / key_points
- Adding generic "contact us for inquiry" CTA (no specific cert claims)
