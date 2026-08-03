# Trial Cohort — June 2026 Conversion Decisions

## Product Lineup

Three tiers:
- **Starter**: $29/mo, $278/yr
- **Pro**: $79/mo, $758/yr  
- **Enterprise**: $199/mo only (contract-based, no self-serve annual option)

## Accounts

| Account | Email | Plan on Trial | Sales Decision |
|---|---|---|---|
| Alice Chen | alice@startup.io | Starter | Converting — standard monthly, no issues |
| Bob Rivera | bob@agency.co | Pro | Upgrading to Enterprise — they loved the analytics suite |
| Carol Zhang | carol@design.studio | Pro | Needs 30 more days to evaluate, then convert to Pro monthly |
| Dave Okafor | dave@consulting.ng | Starter | Converting to Starter annual — offered 15% first-year discount to close the deal |
| Eve Larsson | eve@nordic.tech | Pro | Card on file declined last week — they sent new card details, need to verify the new card before setting up Pro monthly billing |
| Frank Bauer | frank@retail.de | Starter | Not converting — mark as churned, reason: pricing too high for their volume |

## Notes

- Every converting customer needs their payment method verified before we attach any recurring billing.
- We track all billing lifecycle events at `https://hooks.saas.io/billing` — make sure we get notified when subscriptions and payment verifications happen.
- Carol's 30-day extension means she gets the first month free, then normal Pro billing after that.
- Dave's 15% discount is a one-time thing for the first payment only.
- Output `outputs/conversion_summary.json` with what you set up for each account.
