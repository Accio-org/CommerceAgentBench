# Shipping Requirements

## Route
- **Origin**: Hangzhou, Zhejiang, China (Business address — factory pickup)
- **Destination**: Los Angeles, CA, United States (Business address — warehouse delivery)

## Cargo
- **Type**: Full Container Load (FCL)
- **Container**: 1 × 40' Standard container
- **Goods are ready**: Yes, ready for immediate pickup

## Goods
- **Commodity**: Consumer Electronics (Bluetooth Earbuds)
- **Total Value**: $48,000 USD
- **Hazardous**: No

## Services Required
- **Insurance**: Yes — transport insurance is required
- **Customs Brokerage**: Yes — need US import customs clearance
- **Bond Type**: Single entry bond (this is a one-time shipment)

## Constraints
- **Budget**: Total all-in cost must be under $7,000 USD
- **Priority**: Select the **fastest delivery option (shortest transit time)** that stays within the $7,000 budget
- If multiple quotes tie on transit time range, prefer the one with the earlier worst-case arrival (lower upper bound)
- No specific delivery deadline — speed is the primary optimization criterion within budget

## Decision Logic
1. Gather all available quotes with their total all-in prices
2. Eliminate any quote with a total exceeding $7,000
3. Among remaining quotes, rank by transit time (ascending)
4. Book the fastest (shortest transit time) within-budget option
