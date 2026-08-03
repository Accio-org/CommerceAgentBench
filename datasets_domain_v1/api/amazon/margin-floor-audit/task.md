I'm the marketplace ops analyst at **NorthBridge Accessories** (3P seller on Amazon US). Pricing already approved a small batch of price changes — they're in `workspace/approved_price_updates.csv`, and each row is already tagged whether it should go out as an immediate Listings PATCH or via the batch feed. I'm not recomputing the business case; my job is to use SP-API correctly to validate the batch, publish the valid updates through the requested channel, and archive the API evidence.

SP-API is only reachable at `http://127.0.0.1:4000` from this container. Use seller id `A2BENCH00001`, US marketplace id `ATVPDKIKX0DER`, and send header `x-amz-access-token: ccb`. No external network. Discover exact endpoints, required fields, status codes, pagination tokens, and document URLs via `GET /api/help`.

A row only qualifies for publication if it still matches live US listing state: it must refer to an existing US SKU for `A2BENCH00001`, its listing summary status must include `BUYABLE`, and the current price must still equal the price shown in the approval queue. Rows that can't be published must stay unpublished and be recorded with the **most accurate** skip code from this set: `stale`, `not_buyable`, `not_in_us`, `discontinued`, `suppressed`, `price_exceeds_cap`, `price_below_floor`, `pending_review`, `duplicate_sku`, `missing_offer`, `listing_deactivated`, `asin_mismatch`, `brand_restricted`, `stranded`, `inventory_zero`.

Immediate-channel rows go through Listings PATCH and **must** run a validation preview before the apply write. Feed-channel rows go out as one `JSON_LISTINGS_FEED` for `ATVPDKIKX0DER`. The release packet also needs a downloaded settlement report sample and the feed processing report.

Drop the final evidence under `outputs/`. Files may carry extra fields, but these auditable facts have to survive:

- `outputs/feed_submission.json` — feed creation/submission evidence plus the exact JSON feed body that was uploaded.
- `outputs/feed_processing_report.xml` — the downloaded feed processing report.
- `outputs/listings_patch_preview.json` — the validation-preview responses for immediate-channel rows, captured *before* the apply writes. Shape: `{"previews": [{"sku": "<sku>", "preview_response": { ...raw preview API response... }}]}`.
- `outputs/skipped_price_updates.json` — the unpublished approval rows with SKU and skip reason. Shape: `{"skipped_updates": [{"sku": "<sku>", "reason": "<skip code>"}]}`.
- `outputs/settlement_report_sample.tsv` — the downloaded settlement report sample.

The deliverable is the SP-API state plus those evidence files — no margin spreadsheet, no recomputed profitability.

Treat PATCH requests, feed submissions, and report creation as stateful API writes, not scratch-pad ops. Lock in each row's validation decision *before* applying writes; if you need to retry after a partial failure, resume from the writes/evidence you already created instead of reclassifying rows from post-publication state. Validate every Listings PATCH before applying — no exploratory write requests with prices or SKUs that aren't in the approved queue.
