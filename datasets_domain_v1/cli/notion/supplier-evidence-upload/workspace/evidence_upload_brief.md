# Supplier Certificate Evidence Brief

The procurement team needs one Notion handoff for the certificate packet that fails the June launch policy.

Inputs:

- `supplier_packets/certificate_queue.csv` lists the supplier packets under review.
- `supplier_packets/iso_review_policy.md` defines the hold rules.
- `supplier_packets/*.txt` contains the packet evidence.

Output conventions:

- Evidence filename: `supplier-certificate-audit-<supplier-slug>.txt`, where the supplier slug is the lowercase supplier name with spaces and punctuation replaced by hyphens, repeated hyphens collapsed, and leading/trailing hyphens trimmed.
- Evidence file body: one line per fact, using exactly these labels —
  `Supplier: <supplier name>`, `Certificate reviewed: <certificate id>`, `Purchase order: <PO id>`,
  `Decision: <decision code>`, `Owner: <owner>`, followed by the hold reason (name the specific
  certificate number problem).
- Handoff page H1: `# Supplier certificate audit handoff - <Supplier Name>`
- Legal-hold owner: `procurement-ops`

Only the supplier that fails the policy should receive a new evidence file and a new handoff page. Suppliers that pass should not be uploaded or staged in Notion.
