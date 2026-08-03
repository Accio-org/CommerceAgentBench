# Expected facts / LLM judge ground truth (browser-web-research-unitedenergytech-huayue-comparison v2)

This file is **not shown to the agent**. Verifier injects into LLM judge prompt as ground-truth.

## Subjects

- **Target**: `https://unitedenergytech.en.alibaba.com/` — Alibaba International Station shop
- **Benchmark**: `https://huayuecorp.en.alibaba.com/` — competitor / benchmark Alibaba shop

Both URLs follow the `<slug>.en.alibaba.com` pattern. The agent must determine each shop's actual main category from the live page.

## Required browsing per shop

Each shop must be inspected across 5 page types:
1. **home** — Storefront / landing page
2. **products** — Product list or category page
3. **pdp** — A representative Product Detail Page (one of their actual products)
4. **company_profile** — About Us / Company info
5. **inquiry_path** — Inquiry form / Contact button page (open it, but DO NOT submit)

## Five comparison dimensions

The agent must compare the two shops across these 5 dimensions:
1. 店铺结构 (shop structure / IA)
2. 产品呈现 (product display)
3. 信任背书 (trust signals: certifications, cases, reviews, response time)
4. 询盘路径 (inquiry path: how easy to ask, how many fields)
5. 商详页转化设计 (PDP conversion design: hero, video, MOQ, lead-time, key bullets)

## Forbidden behaviors

- Login (any account)
- Click final "Send Inquiry", "Submit Form", "Contact Merchant" — opening the page is OK
- Use a local "candidate pool" — must be from real public web
- Forbidden terms in output: `local_seed_only`, `seed_only`, `本地池`, `本地种子`, `local seed pool`

## Anti-cheat for fabrication

- Each PDP claim ("benchmark uses 3D viewer") should match the corresponding screenshot
- Specific MOQ / response-time / certification claims must trace to a screenshot or manifest observation
- "Continue to optimize page" / "improve quality" / vague generalities → not concrete enough

## Acceptable variability

- Either or both shops may be temporarily inaccessible (region/CAPTCHA/etc.)
- If one shop is fully blocked, the agent gets credit for the visible portions and the blocker.png
- The 7/14/30 day plan is forward-looking, so it's about improving target based on benchmark gaps
