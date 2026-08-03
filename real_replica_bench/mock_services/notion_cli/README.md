# Notion CLI Mock

Local Notion-style CLI mock used by RealReplicaBench tasks.

## Seed Profiles

The default seed is intentionally small so smoke tests stay quick and stable.

Set `NTN_MOCK_SEED_PROFILE=commerce` before starting the server to load a realistic ecommerce operations workspace:

```bash
NTN_MOCK_SEED_PROFILE=commerce bun lib/server/index.js
```

The commerce profile adds deterministic ecommerce workspace data, including a web-research-informed operations knowledge library:

- 890 pages
- 9 data sources / databases
- 92 files
- 10 workers
- 12 capabilities
- 9 sync states
- 13 run records

Major ecommerce data sources:

- `db_commerce_products` / `ds_commerce_products` — Commerce Product Catalog, 240 SKU pages
- `db_commerce_listing_ops` / `ds_commerce_listing_ops` — Marketplace Listing Ops, 160 localization/QA pages
- `db_commerce_suppliers` / `ds_commerce_suppliers` — Supplier Due Diligence, 90 review pages
- `db_commerce_purchase_orders` / `ds_commerce_purchase_orders` — Purchase Order Tracker, 140 PO pages
- `db_commerce_inventory` / `ds_commerce_inventory` — Inventory Replenishment, 100 warehouse/SKU pages
- `db_commerce_campaigns` / `ds_commerce_campaigns` — Campaign Calendar, 60 campaign pages
- `db_commerce_customer_issues` / `ds_commerce_customer_issues` — Customer Issue Queue, 75 support/escalation pages
- `db_commerce_knowledge` / `ds_commerce_knowledge` — Commerce Knowledge Library, 16 long-form SOP/runbook pages grounded in public ecommerce docs

Example:

```bash
ntn datasources resolve db_commerce_products
ntn --json datasources query ds_commerce_products --limit 5 --filter '{"Market":"JP","RiskFlag":"Yes"}'
ntn --json datasources query ds_commerce_knowledge --filter '{"Domain":"Feed Quality"}'
ntn --json api v1/search -d '{"query":"Prime Day"}'
```

For benchmark tasks, set `NTN_MOCK_SEED_PROFILE=commerce` in the task service environment or `task.toml` runtime mock env, then layer any task-specific private `seed_overlay.json` on top.
