# ISO Review Policy

Use `HOLD_FOR_LEGAL_REVIEW` when any of these conditions are true:

- The certificate site address does not match the supplier site listed in `certificate_queue.csv`.
- The certificate expires before the declared launch date.
- The certificate number is missing from the packet.

Use no Notion upload for suppliers that pass all checks.

The hold handoff should name the supplier, certificate, purchase order, owner, decision, and the specific failed condition.
