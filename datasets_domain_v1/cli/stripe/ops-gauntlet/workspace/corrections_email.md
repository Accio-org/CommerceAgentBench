From: Sarah Park (Finance)
To: Maya Chen, QA Sprint Channel
Date: 2026-06-02 09:14 AM
Subject: RE: QA Sprint — couple corrections

Hey Maya —

1. **Analytics Dashboard price is wrong** — PM confirmed it's $59.99/mo as of June 1, not $49.99. Annual adjusts accordingly.

2. **Payment notifications**: Jake says drop the charge-level failure notifications — their SDK handles that client-side now and the duplicates were causing flaky tests. They do need refund notifications though for receipt generation.

3. **The 20% discount code**: compliance flagged 25% as triggering an audit in staging. Changed to 20%. Keep the existing name.

4. **Descriptions**: the test harness UI matcher needs every product to have a description. Just use the product name — I know it's redundant but their assertion requires it.

—Sarah
