# State Manifest

This task is fully offline. Use only files under your task input directory `/task/workspace/`.

The source page and policy files are local snapshots prepared for this benchmark. Do not browse the live web.

Primary local sources:

- `source_pages/alibaba_product_page_snapshot.html` - readable, self-contained offline product-page snapshot derived from the raw Alibaba page. It references downloaded product images from the local `assets/alibaba_product_images/` folder and should be used as the main source-page reference.
- `source_pages/raw/alibaba_product_page_raw.html` - raw Alibaba product-introduction HTML fragment captured from the public page. It includes page chrome, embedded JSON, related-search noise, remote CSS dependencies, and product content; keep it as provenance rather than the main reading surface.
- `source_pages/assets/alibaba_product_images/` - six downloaded product images from the raw page's `pageProductCard.productImage.urls` array plus a local source manifest.
- `policies/full_reference/ftc_green_guides_16_cfr_part_260.pdf` - official FTC Green Guides PDF, 36 pages.
- `policies/full_reference/amazon_listings_product_detail_page_guide.pdf` - Amazon Product Detail Page Guide PDF, 6 pages.
- `certificates/supplier_certificate_summaries.md` - supplier evidence packet with certificate scopes, validity dates, and non-authoritative sales notes.
- `lab_test_results.csv` - mixed lab-result export covering HPT-750-SS plus nearby SKU/component distractors.

Treat the PDFs and Alibaba page snapshot as the authoritative policy/source-page evidence. Internal notes may help identify review concerns, but they do not override source scope, certificate scope, or platform policy.
