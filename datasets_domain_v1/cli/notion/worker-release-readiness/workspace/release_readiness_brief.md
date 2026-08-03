# Supplier Portal Cutover Brief

The supplier portal release team is preparing the production order-sync worker for the Monday cutover. There are several similarly named workers in the workspace because preview and catalog jobs share parts of the same naming scheme.

Use the worker that meets all of these conditions:

- Its deployed capabilities include `syncSupplierOrders`.
- The capability title is `Supplier portal order sync`.
- It is the production worker, not a preview, sandbox, catalog, finance, or data-importer worker.

Production environment values:

- `SHOPIFY_ADMIN_TOKEN=shopify-admin-prod-2026-06`
- `SUPPLIER_PORTAL_BASE=https://supplier.example.test`

Cutover operations:

- Remove the obsolete `DATABASE_URL` value from the production supplier portal worker before deploying.
- Deploy the production supplier portal worker one time after the environment cleanup.
- Trigger `syncSupplierOrders` once so the new run is visible in Notion.
- Pause `backfillLegacyOrders`; it should not run during the cutover window.
- Leave preview/sandbox workers, catalog workers, finance workers, and data-importer workers unchanged.
