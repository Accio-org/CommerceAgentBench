# Trade Finance Pipeline Policy

Version: 2026-06  
Status: Active  
Owner: Trade Finance Operations

## 1. Scope

This policy governs the trade finance pipeline for US export customs data analysis. It applies to all regional customs data files (Dongying, Zibo, Guangzhou) and defines the criteria for supplier qualification, priority classification, and required actions across DWS, Stripe, and Todoist systems.

## 2. Data Aggregation

All three regional CSV files must be aggregated by the `supplier` column. For each supplier, compute:

- **total_shipments**: Count of rows
- **total_weight_kg**: Sum of `weight_kg` (treat empty/missing as 0)
- **total_amount_usd**: Sum of `amount_usd` (treat empty/missing as 0)
- **unique_buyers**: Count of distinct `buyer` values
- **unique_hs_chapters**: First 2 digits of each distinct `hs_code` value (exclude empty codes)
- **unique_ports**: Count of distinct `port_of_loading` values

## 3. Supplier Qualification & Priority

### Priority A (Strategic / High-Volume)
- total_amount_usd > $2,500,000 AND total_shipments > 40
- Todoist priority: p1
- Stripe: Full payment infrastructure + volume discount coupon (5% off)

### Priority B (Important / Growth)
- total_amount_usd > $1,200,000 AND total_shipments > 20
- Todoist priority: p2
- Stripe: Full payment infrastructure

### Priority C (Qualified / Emerging)
- total_amount_usd > $600,000 AND total_shipments > 30
- Todoist priority: p3
- Stripe: Customer record + invoice only

Suppliers not meeting any threshold are excluded from the pipeline.

## 4. DWS Document Requirements

### 4.1 Folder Structure
- Create folder: `Trade Finance Analysis - 2026-06`
- All analysis documents go in this folder

### 4.2 Main Report
- Document name: `US Export Supplier Risk Assessment`
- Content must include:
  - Executive summary block with total qualified suppliers, total pipeline value, and regional breakdown
  - One data block per qualified supplier containing: supplier name, priority level, total_shipments, total_amount_usd, total_weight_kg, unique_buyers, HS chapters
  - Suppliers ordered by total_amount_usd descending

### 4.3 Regional Sub-Reports
- Copy the main report once per region (dongying, zibo, guangzhou)
- Rename each copy: `Regional Report - <Region>`
- Move each to the analysis folder

### 4.4 Collaboration
- Add comment on the main report: `Trade finance pipeline initialized. Review required before invoice finalization.`
- Share with all team members listed in team_roster.csv as EDITOR

### 4.5 File Management
- Upload each regional CSV to DWS
- Export the main report as docx to `outputs/`
- Download the main report for verification

## 5. Stripe Payment Infrastructure

### 5.1 Customers
- One customer per qualified supplier
- Name: exact supplier name from CSV
- Email: derive from supplier name (lowercase, replace spaces with dots, append @supplier.example.com — use first 3 words only)
- Metadata: `priority=<A|B|C>`, `region=<region>`, `total_amount=<total_amount_usd>`

### 5.2 Products
- One product per unique HS chapter across all qualified suppliers
- Product name: `HS Chapter <XX> Trade Goods`
- Description: include the 2-digit chapter code

### 5.3 Pricing
- For each product, create a price:
  - unit_amount = 10000 (i.e., $100.00) as a standardized processing fee per shipment
  - currency = usd

### 5.4 Tax Rates
- Create one tax rate per region:
  - Dongying: display_name `Dongying Import Tariff`, percentage 6.5
  - Zibo: display_name `Zibo Import Tariff`, percentage 5.0
  - Guangzhou: display_name `Guangzhou Import Tariff`, percentage 7.5

### 5.5 Volume Discount
- Create one coupon: `PRIORITY_A_VOLUME` with percent_off = 5 (for Priority A suppliers)

### 5.6 Invoices
- One draft invoice per qualified supplier (attached to their customer)
- For each invoice, add one invoice item per HS chapter that supplier uses
  - Use the corresponding product's price
- Update the invoice description with: `Trade finance processing - <supplier name> - Priority <A|B|C>`

### 5.7 Payment Links
- Create one payment link using the first product's price (as a sample/template link)

## 6. Todoist Task Queue

### 6.1 Project
- Project name: `Trade Finance Pipeline - 2026-06`

### 6.2 Sections
- `Priority A Follow-up`
- `Priority B Follow-up`
- `Priority C Follow-up`
- `Completed Setup`

### 6.3 Tasks
- One task per qualified supplier in the matching priority section
- Content: `[Priority <A|B|C>] <supplier name> - $<total_amount_usd> - <total_shipments> shipments`
- Priority: p1 for A, p2 for B, p3 for C
- Labels: `trade-finance`, `priority-<a|b|c>`

### 6.4 Lifecycle
- After creating all supplier tasks, create one setup task in `Completed Setup`:
  `Pipeline setup complete - <N> suppliers qualified`
- Close (complete) this setup task
- Verify it appears in the completed list

### 6.5 Section Rename
- After all tasks are created, rename each priority section to include count:
  - `Priority A Follow-up (N suppliers)` where N is the actual count

### 6.6 Correction Flow
- If a supplier task was created with wrong priority, close it, then reopen after correction
- At minimum: close and reopen one Priority C task to exercise the flow

## 7. Cross-System Traceability

After all systems are populated, update each Todoist supplier task content to include:
- The Stripe customer ID
- Reference format: append ` | Stripe: <customer_id>` to the task content

This ensures every supplier can be traced from Todoist back to Stripe.
