# Overseas Checkout QA Brief

The workspace has a Notion task database for the vendor launch. Resolve database `db_001` to its data source and query the task rows rather than relying on page IDs.

The page that needs a blocker update has all of these traits:

- Area: `Overseas Checkout`
- Status: `Open`
- Priority: `1`
- Its content mentions SSO login trouble for B2B buyers.

Update that blocker page so it keeps the same H1 and includes:

- `Hold for overseas checkout QA`
- `Owner: Mei Chen`
- `SSO login outage affects B2B buyers before vendor launch`

Create a new handoff page under the workspace root with H1 `# Vendor QA Release Notes`. Its content should include:

- `Ready items: Add dark mode is closed.`
- `Blocked items: Fix login bug remains open pending SSO evidence.`
- `Next checkpoint: 2026-06-05.`

Cleanup rule:

- Trash the stale root documentation page titled `API Reference` whose content only points readers to official docs.
- Do not trash `API Reference - checkout v2`; it belongs to the QA database and is still useful for the review.
- Leave closed and unrelated task pages unchanged.
