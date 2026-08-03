# Shipping Requirements

## Route

- **Origin:** Shenzhen, China
- **Destination:** New York, USA

## Cargo Specifications

| Parameter        | Value                   |
|------------------|-------------------------|
| Container Type   | 40' FCL (Full Container Load) |
| Quantity         | 1 container             |
| Goods Value      | $30,000 USD             |
| Commodity Type   | Consumer Electronics    |

## Required Add-On Services

### Insurance
- **Include:** Yes
- Coverage based on declared goods value of $30,000 USD

### Customs Clearance
- **Include:** Yes
- Required at destination (USA)

### Bond
- **Type:** Single Entry Bond
- Covers a single import transaction

## Quote Selection Process

The agent must apply a two-step selection process:

### Step 1 — Identify the 3 Cheapest Quotes
- Retrieve all available quotes for the specified route.
- Calculate the **total all-in price** for each quote, including:
  - Base ocean freight rate
  - Insurance premium
  - Customs clearance fee
  - Bond fee
  - Platform/handling fee (if any)
- Rank all quotes from lowest to highest total all-in price.
- Select the **top 3** (cheapest) quotes.

### Step 2 — Select Best Rated Among the Top 3
- Among the 3 cheapest quotes, compare **seller ratings** (star rating out of 5).
- Select the quote with the **highest seller rating**.
- **Tiebreaker:** If two or more quotes share the same rating, prefer the one with the greater number of customer reviews.

## Budget & Deadline

- No maximum budget constraint.
- No deadline constraint — select purely on the rating criterion above.

## Output Requirements

Produce a file at `outputs/booking_confirmation.md` containing:

1. The selected quote ID and carrier/seller name
2. Full price breakdown (line items)
3. Seller rating and review count
4. The ranked list of the 3 cheapest quotes considered
5. Rationale for final selection
6. Booking submission confirmation
