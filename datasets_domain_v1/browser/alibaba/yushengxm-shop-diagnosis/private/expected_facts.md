# Expected facts / LLM judge ground truth (browser-alibaba-yushengxm-shop-diagnosis v2)

This file is **not shown to the agent**. Verifier injects into LLM judge prompt as ground-truth.

## Subject

- **Target shop**: `https://yushengxm.en.alibaba.com` — Yusheng XinMin (Quanzhou Yusheng Xinmin Pet Industry Co., Ltd. or similar). The agent must determine the actual main category from the live page.
- This is an Alibaba International Station shop. The shop URL pattern `<slug>.en.alibaba.com` is the shop's en-version landing.
- Likely category: **pet products** (food / toys / supplies) based on the slug, but the agent must verify on the live page.

## Public-web research expectations

The agent MUST:
- Visit the target shop's home + products + company profile pages
- Find 10 distinct Alibaba International Station shops (other `*.en.alibaba.com`) in the same category
- Find 5 distinct independent (non-Alibaba) sites in the same category — these can be brand websites, Shopify stores, Amazon listings, etc.

## Forbidden behaviors

- Login (any account)
- Send RFQ / contact merchant / submit form
- Use a local "candidate pool" or "seed list" — agent must browse and find peers from public search

## Anti-cheat: forbidden terms

The following terms must NOT appear in the report or manifest:
- `local_seed_only`
- `seed_only`
- `本地池`
- `本地种子`
- `local seed pool` / `local pool`

These are red flags that the agent treated a local file as a peer pool instead of doing real web research.

## Acceptable peer variability

There is no canonical "the 10 Alibaba peers" — the agent should find any 10 distinct competitor shops. Each peer's `positioning` and `reference_value` should be specific to that peer's actual page (not generic "B2B 网站结构清晰").

## Section quality bar

- Sections 5/6 (国内/国外市场机会): need >=2 specific opportunities tied to the target's category and peer findings, not boilerplate
- Section 7 (7/30/90 day plan): each timeframe needs >=2 concrete action items
- "Continue to optimize" / "improve quality" → not concrete enough → fail

## Anti-cheat for fabrication

- Each peer URL must be a real public URL (LLM should sanity-check whether the URL pattern is plausible — `xxxxxx.en.alibaba.com` for Alibaba peers, real domain names for independents)
- Each peer's positioning/reference_value should match what's visible on the screenshot (LLM has access to manifest, can sanity-check internal consistency)
