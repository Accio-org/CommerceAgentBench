# Freight Anomaly Investigation Report

## Alert Information
- **Alert ID**: [FRT-XXX]
- **Supplier**: [Supplier Name]
- **Route**: [Origin -> Destination]
- **Investigation Date**: [Date]

## Freight Comparison
| Year | Freight Cost (USD) | Weight (kg) | Rate (USD/kg) | Shipments |
|------|-------------------:|------------:|-------------:|----------:|
| 2024 | | | | |
| 2025 | | | | |

## Data Sources Reviewed
- Customs CSV data (2024 and 2025): [Reviewed/Not reviewed]
- Shipping manifest: [Reviewed/Not reviewed]
- Freight rate schedule: [Reviewed/Not reviewed]

## Findings

### Manifest Weight vs CSV Weight
- Manifest declared weight: [weight] kg
- CSV recorded weight: [weight] kg
- Match: [Yes/No]

### Rate Schedule Check
- 2024 applicable rate: $[rate]/kg
- 2025 applicable rate: $[rate]/kg
- Rate changed: [Yes/No]

### Volume Analysis
- 2024 shipment count: [N]
- 2025 shipment count: [N]
- Volume change: [description]

## Root Cause Determination
**Root Cause Code**: [VOLUME_GROWTH | WEIGHT_TYPO | RATE_CHANGE]
**Root Cause**: [identify and explain the root cause]

[Detailed explanation of the root cause]

## Recommended Action
[Describe any corrective actions needed and the systems they should be applied in]

## Adjustment Calculation (if applicable)
- Correct freight: [weight] kg x $[rate]/kg = $[amount]
- Billed freight: [weight] kg x $[rate]/kg = $[amount]
- Adjustment amount: $[difference]
