# Sourcing Policy — Multi-Category Procurement Control Tower

## 1. Product Categories and Data Sources

| Category ID | Description | Source File | HS Code Filter |
|---|---|---|---|
| auto_bearings | Automotive bearings | auto_bearings.csv | 8482 |
| industrial_chemicals | Zibo industrial exports | zibo_us_exports.csv | Various |
| batteries | Lithium/lead-acid batteries | battery_export_002.csv | 8507 |

## 2. Supplier Aggregation

Within each category's CSV:
- Group records by the `supplier` field (exact match, case-sensitive)
- Sum `amount_usd` to get total procurement value
- Count records to get total shipment count
- Collect unique 4-digit HS codes (first 4 characters of `hs_code`)

**Important**: Each category has its own CSV. Do NOT merge suppliers across categories even if names happen to match.

## 3. Qualification Thresholds

A supplier qualifies if it meets BOTH conditions in any tier:

| Tier | Total Amount USD | AND Shipment Count | Jira Priority |
|---|---|---|---|
| Strategic | > $500,000 | > 20 shipments | Highest |
| Preferred | > $200,000 | > 10 shipments | High |
| Approved | > $80,000 | > 5 shipments | Medium |

Apply the highest matching tier. A supplier must meet BOTH the amount AND shipment count threshold for a tier.

## 4. Selection Rule

After applying qualification thresholds:
- Within each category, rank qualified suppliers by total amount (descending)
- Select the **top 3** qualified suppliers per category
- Final list = top 3 from auto_bearings + top 3 from industrial_chemicals + top 3 from batteries

## 5. Tier Labels for Jira

| Tier | Jira Label |
|---|---|
| Strategic | tier-strategic |
| Preferred | tier-preferred |
| Approved | tier-approved |

All supplier tasks also carry the fixed label `sourcing-control`.

## 6. Jira Task Summary Format

```
[{Tier}] {Supplier Name} — {category}, {shipment_count} shipments, ${amount_usd}, owner: {owner}
```

Example:
```
[Strategic] ACME CORP — batteries, 45 shipments, $1500000, owner: Chen Yue
```

## 7. Cross-System Traceability

Each Jira Task must have a trace comment in this exact format:

```
Trace: GWS row {row_number}; Box folder {box_folder_id}.
```

Where:
- `row_number` = the supplier's row in the Sourcing Dashboard (row 1 is headers, row 2 is the first supplier, etc.)
- `box_folder_id` = the Box folder ID returned when creating that supplier's subfolder

## 8. GWS Sourcing Dashboard Headers

```
Supplier | Category | Tier | Total Amount USD | Shipment Count | HS Codes | Owner | Jira Task Key | Box Folder ID
```

- Sort rows by Total Amount USD descending
- Total Amount USD = exact computed sum from CSV (numeric)
- HS Codes = comma-separated sorted list of unique 4-digit HS codes (e.g., "3907, 7013, 8475, 9001")

## 9. GWS Category Comparison Headers

```
Category | Qualified Suppliers | Total Amount USD | Total Shipments | Top Supplier
```

- One row per category (auto_bearings, batteries, industrial_chemicals) — alphabetical
- Qualified Suppliers = count of selected suppliers in that category (should be 3 each)
- Total Amount USD = sum across that category's selected suppliers
- Total Shipments = sum of shipment counts
- Top Supplier = the selected supplier with the highest amount in that category

## 10. Slides Briefing Content

The presentation should include:
- Title slide with "Procurement Sourcing Strategy Brief Q1 2026"
- At least one slide per category summarizing qualified suppliers
- Mention the epic name "Multi-Category Sourcing Q1 2026"
- Include counts: total qualified suppliers, number per tier (Strategic, Preferred, Approved)

## 11. Box Document Repository Structure

```
Procurement Control Tower/
  ├── {Supplier 1 Name}/
  │   └── sourcing_analysis_{safe_name}.txt
  ├── {Supplier 2 Name}/
  │   └── sourcing_analysis_{safe_name}.txt
  ...
```

- Upload one sourcing analysis file per supplier
- Share the root folder with all team members listed in procurement_team.csv
- Create review tasks on files for Strategic and Preferred tier suppliers
- Add a Box comment on each uploaded analysis file referencing the supplier's Jira task key.

## 12. Team Assignment

Assign each supplier's Jira Task and Box operations to the category owner from `procurement_team.csv`.
