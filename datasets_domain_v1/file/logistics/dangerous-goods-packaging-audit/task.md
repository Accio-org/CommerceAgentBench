I'm the compliance reviewer for a mixed ecommerce shipment containing consumer products that may have dangerous-goods restrictions. I need you to determine which SKUs can ship by air, which must be ground-only, which require label/packaging changes, and which should be blocked pending missing documentation. Don't rely on product marketing names or merchant exception requests alone — every SKU's hazard determination has to be traced back to the matching SDS PDF (its filename and the section / UN identifier).

Everything is local under `workspace/` — offline task, use only these files. The SDS PDFs are in `sds/` (one per SKU). The rules and policies are `carrier_rules/air_ground_dg_rules.pdf`, `marketplace_policy/dangerous_goods_listing_policy.pdf`, and `marketplace_policy/amazon_dangerous_goods_identification_guide.pdf` (Amazon Shipping's dangerous-goods identification guide, copied locally). The SKU data and operational state are in `products/sku_packaging_specs.csv`, `photos/packaging_and_label_photos/` (packaging and label photos), `exceptions/merchant_exception_requests.csv`, `warehouse/label_inventory.csv`, `warehouse/channel_promise_matrix.csv`, and the internal `messages/fulfillment_launch_thread.md`. Work each SKU across the SDS sections, carrier rules, marketplace policy, packaging specs, merchant exception requests, label inventory, channel-promise state, and the local photos.

Write exactly three files to `outputs/`: `dg_audit.json`, `shipping_matrix.csv`, and `operations_brief.md`.

`dg_audit.json` shape:

```json
{
  "sku_decisions": [
    {
      "sku": "SKU-EXAMPLE",
      "ship_status": "air_ok | ground_only | block_pending_docs | block_not_allowed",
      "hazard_basis": ["short prose summary of why"],
      "evidence_items": [
        {
          "source_file": "workspace/sds/sku-example_sds.pdf",
          "section_or_un_number": "§14 UN3481",
          "note": "Class 9 lithium ion packed with equipment"
        },
        {
          "source_file": "workspace/sds/sku-example_sds.pdf",
          "section_or_un_number": "§2 Hazard identification",
          "note": "Transport hazard summary"
        },
        {
          "source_file": "workspace/carrier_rules/air_ground_dg_rules.pdf",
          "section_or_un_number": "§3 Limited quantity and documentation exceptions",
          "note": "UN3481 air conditional on Wh + battery mark + equipment packing"
        }
      ],
      "packaging_actions": ["required label, inner packaging, quantity, or documentation action"],
      "documentation_gaps": ["missing_lithium_battery_mark", "missing_wh_rating"],
      "channel_promise_action": "keep_air | disable_air | keep_ground_only | block_until_docs",
      "confidence": "high | medium | low"
    }
  ],
  "cross_sku_notes": ["short notes"]
}
```

A few field requirements. `evidence_items` (per SKU, required): each entry must include `source_file` pointing at the local file you actually relied on (use the `workspace/...` relative path), `section_or_un_number` (e.g. `§14 UN1950`, `Section 4 Transport information`, `UN3480`), and a short `note`; for dangerous-goods SKUs, cite the SKU's own SDS PDF and reference the correct UN number from its transport-information section. `documentation_gaps` (per SKU): use short snake_case codes drawn from this closed set when applicable — `missing_lithium_battery_mark`, `missing_section_14`, `missing_un_label`, `missing_packaging_group_evidence`, `missing_oxidizer_label`, `missing_limited_quantity_mark`, `missing_wh_rating`, `missing_aerosol_lq_program`, `missing_air_carrier_approval`, `missing_inner_packaging_confirmation`, `missing_outer_battery_mark`, `missing_orientation_arrows`, `missing_short_circuit_protection`, `missing_state_of_charge_evidence`, `missing_equipment_packing_method`, `missing_carrier_lq_approval` (empty list is fine for non-DG SKUs). `channel_promise_action` (per SKU, required): one of `keep_air | disable_air | keep_ground_only | block_until_docs`.

`operations_brief.md` is an actionable summary aimed at the fulfillment + ops teams — mention the specific SKU IDs that need air disabled / shipments held / labels added, and avoid blanket statements like "guaranteed compliant" or "safe for all air".
