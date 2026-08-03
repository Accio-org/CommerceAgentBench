# NorthBridge Accessories — Logistics & Landed-Cost Reference (Project Atlas)

Supplier quotes arrive on different **Incoterms** and in different **currencies**, so a raw unit price is not comparable across suppliers. To compare offers fairly, convert each quote to a **per-unit landed cost in USD**: convert the quoted unit price to USD, then add the logistics costs the **buyer** must bear under that Incoterm.

## Currency conversion (apply first)

Convert every non-USD quote to USD using these reference rates before doing anything else:

| Currency | 1 unit = USD |
|---|---|
| USD | 1.0000 |
| EUR | 1.0800 |
| GBP | 1.2700 |
| JPY | 0.0067 |
| CNY | 0.1400 |

## Per-unit logistics cost components (Project Atlas lane: origin Asia/EU → our US DC)

| Component | Per-unit cost (USD) |
|---|---|
| Origin handling & export clearance | 0.85 (flat) |
| Ocean freight & cargo insurance | **volume-tiered** — see table below |
| Import duty (HS 8473.30) | **4.5% of the USD unit price** (a rate, not a flat fee) |
| Destination port fees, customs brokerage & last-mile to DC | 1.15 (flat) |

### Ocean freight & cargo insurance — by total order quantity

Freight per unit depends on the **final order quantity** (bigger orders ship cheaper per unit). Use the tier that matches the final required volume from your inbox.

| Total order quantity | Freight & insurance (USD/unit) |
|---|---|
| 1 – 2,000 units | 2.90 |
| 2,001 – 3,000 units | 2.50 |
| 3,001 – 5,000 units | 2.20 |
| more than 5,000 units | 1.95 |

If a supplier quotes **tiered (volume-break) pricing**, take the unit price for the band that contains the **final order quantity** (then convert to USD and add logistics as above).

## Which components the buyer adds, by Incoterm

Standard Incoterms responsibility ladder — the buyer adds every component the seller does **not** already cover. (Duty = the rate above applied to the USD unit price; freight = the tiered value above.)

| Incoterm | Buyer also pays: origin? | freight? | duty? | destination? |
|---|:--:|:--:|:--:|:--:|
| **EXW** (Ex Works) | yes | yes | yes | yes |
| **FOB** (Free On Board) | no | yes | yes | yes |
| **FCA** (Free Carrier) | no | yes | yes | yes |
| **CIF** (Cost, Insurance, Freight) | no | no | yes | yes |
| **CIP** (Carriage & Insurance Paid) | no | no | yes | yes |
| **DDP** (Delivered Duty Paid) | no | no | no | no |

```
usd_unit       = quoted_unit_price * fx_rate(currency)   # use the final-qty tier if tiered
landed_per_unit = usd_unit
                + (origin_handling       if buyer pays origin)
                + (freight_for_final_qty if buyer pays freight)
                + (duty_rate * usd_unit  if buyer pays duty)
                + (destination           if buyer pays destination)
```

## Supplier-selection rule

A supplier is **eligible** only if it satisfies **every** current RFQ requirement, reconciled from your inbox (the brief plus the follow-up internal emails). The gates are:

1. **Final finish spec** — matches the most up-to-date finish (later corrections, and any retraction of a correction, supersede the original brief), and the required material / size.
2. **Volume (MOQ)** — the supplier's MOQ ≤ the final required quantity.
3. **Lead time** — the quoted production + delivery lead time (days from PO) is **≤ the number of days from the PO date to the required in-DC date** (compute that day-count from the two dates as they stand after any update; a supplier whose lead time runs past the in-DC date misses the window).
4. **Quality certification** — whatever certification the thread requires, in its **most recent** form (a later email may tighten an earlier, looser rule).
5. **Payment terms** — must satisfy any payment-terms constraint stated in the thread.
6. **Warranty** — must meet any minimum warranty term stated in the thread.

Gates 4–6 are stated in the internal emails, not in this document; treat each as a hard gate from the moment it is stated, in its most recent form.

Among the suppliers that pass **all** gates, choose the one with the **lowest per-unit landed cost (USD)**. Report that supplier's landed cost as `landed_cost_usd`, and the second-lowest eligible supplier as the runner-up.

> A lower **unit price** does not imply a lower **landed cost** (incoterms, currency and the freight tier change the ranking), and a supplier that fails any gate is **not** eligible no matter how cheap it is.
