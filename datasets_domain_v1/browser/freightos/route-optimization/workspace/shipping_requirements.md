# Shipping Requirements

## Shipment Overview

| Field | Value |
|---|---|
| Origin | Dongguan, Guangdong, China |
| Destination | Dallas, TX, United States |
| Cargo Type | Consumer Electronics |
| Container | 1×40' FCL (Full Container Load) |
| Declared Value | $35,000 USD |
| Max Transit Time | **30 days** (from pickup to delivery) |
| Objective | **Minimize total cost** within the deadline |

## Route Structure

This is a multi-leg shipment consisting of three sequential legs:

### Leg 1 — Domestic CN Trucking
- **From:** Dongguan factory
- **To:** Chinese origin port (e.g., Shenzhen, Guangzhou, Yantian, Nansha)
- **Unit:** Days in transit, cost in USD

### Leg 2 — Ocean Freight
- **From:** Chinese origin port
- **To:** US destination port (e.g., Long Beach, Los Angeles, Seattle, Houston)
- **Unit:** Days in transit (use max days for deadline calculation), cost in USD per 40' FCL
- **Constraint:** Origin port must match the domestic leg destination port

### Leg 3 — US Last-Mile Delivery
- **From:** US destination port
- **To:** Dallas warehouse
- **Unit:** Days in transit, cost in USD
- **Constraint:** Origin port must match the ocean freight destination port

## Deadline Calculation

```
Total Transit Days = Domestic CN days + Ocean max days + US delivery days
Requirement: Total Transit Days ≤ 30
```

## Cost Calculation

```
Total Cost = Domestic CN cost
           + Ocean freight cost
           + US delivery cost
           + Insurance (0.42% of cargo value)
           + Customs clearance fee
           + Customs bond fee
           + Platform fee (1.5% of ocean freight)
```

- **Insurance rate:** 0.42% of declared cargo value ($35,000)
- **Insurance cost:** $147.00
- **Platform fee:** 1.5% of ocean freight cost

## Cargo Details

- **Commodity:** Consumer Electronics (circuit boards, sensors, control modules)
- **HS Code:** 8543.70.9960
- **Container:** 1×40' FCL, standard dry container
- **Gross Weight:** ~18,500 kg
- **Volume:** ~62 CBM
- **Special Handling:** None required

## Compliance Requirements

- Insurance coverage is **required**
- US Customs clearance is **required**
- Customs bond is **required**
- All charges must be included in total cost comparison

## Optimization Goal

Enumerate all valid route combinations (domestic leg + ocean leg + US delivery leg) where:
1. Port connections match at each transfer point
2. Total transit time ≤ 30 days

Select the combination with the **lowest total cost** among all feasible options.
