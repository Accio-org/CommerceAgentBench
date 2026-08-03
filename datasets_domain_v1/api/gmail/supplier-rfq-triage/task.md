I'm **Dana Whitfield**, sourcing manager at **NorthBridge Accessories**. I've been out for a few days and my Gmail has piled up. The live sourcing project — **Project Atlas**, an RFQ for an **anodized aluminum laptop stand** — has to move today: the brief, the latest spec, the volume, and all the supplier quotes are sitting in my inbox, and the supplier kickoff call is coming up.

My Gmail is reachable only at `http://127.0.0.1:3071` over the Google-Workspace-style tool surface — `GET /api/workspace/tools` for the tool list / input schemas, and `POST /api/workspace/call` with `{ "name": "<tool>", "arguments": { ... } }` to invoke one. `GET /health` is the readiness probe. Use this surface for every mailbox read and write. No external network.

Two reference docs in `workspace/` set the rules — read them first:

- `sourcing_brief.md` — what I need to produce, the reconciliation rules, the supplier-identity / de-dup rules, and the finance-security policy.
- `landed_cost_reference.md` — currency conversion, freight/duty figures, the Incoterm normalization rules, and the supplier-selection rule. Quotes arrive on different Incoterms **and currencies**, so I must normalize them all to a per-unit USD landed cost.

The RFQ details and the quotes are **not** in the workspace — they're **in the inbox**, spread across many non-adjacent internal emails, with quotes coming under various display names / addresses / domains. Follow `sourcing_brief.md` strictly for both the evolving requirement and the supplier-identity resolution; do **not** just take the last time a value is mentioned, and do **not** trust company names or domains at face value.

Reconcile the Project Atlas RFQ from the inbox using those two reference docs, then compare suppliers on normalized per-unit USD landed cost after resolving variant identities, superseded quotes, retractions, broker-forwarded quotes, and look-alike suppliers.

Once the chosen supplier is identified, leave the mailbox and calendar in the state Dana needs for the upcoming kickoff: label **exactly** the chosen supplier's binding quote with `RFQ-Decision`, label **exactly** the finance-security exception messages with `Security-Review`, create the supplier kickoff calendar event on the kickoff date from the RFQ brief, and save a draft reply to the chosen supplier at the exact email address on the binding quotation. Do not send mail.

Write `outputs/triage_summary.json` as the final summary artifact, following the exact schema in `sourcing_brief.md`, including `allowed_lead_days`, the runner-up, `flagged_email_ids`, and the `disqualified` reason-code map keyed by full company name.

Take time to read the relevant emails carefully before acting — many look similar.
