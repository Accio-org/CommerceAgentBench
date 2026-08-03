# Q2 Supplier Risk Roll-Up — Process Brief

## Background

Each quarter the sourcing team produces a consolidated supplier risk roll-up from the per-supplier audit documents stored in the **Supplier Audits Q2** folder in Drive. This roll-up is the primary input to the quarterly risk review meeting.

## Severity and Status Definitions

**Severity** is assigned by the auditor based on the nature of the finding:

- **High** — a regulatory, legal, or permit violation; a worker-safety hazard that creates direct risk of injury or product harm; or a financial/contractual exposure exceeding USD 50 000 (or equivalent in a single incident). Includes misrepresentation to a buyer or regulator that carries legal liability.
- **Medium** — a documentation, process, or traceability gap with no immediate regulatory or safety consequence; a financial exposure below the USD 50 000 threshold; or a contractual deviation that has not yet caused measurable harm.
- **Low** — cosmetic, housekeeping, or administrative issues with negligible risk.

**Status** reflects current remediation state:

- A finding is **Open** unless the audit record explicitly states that remediation is **complete AND has been verified** (by the auditor, a third party, or a regulatory authority). A finding for which a corrective action has been *ordered*, *planned*, *scheduled*, or *in progress* — even if the supplier has submitted a plan or a notification — is still **Open**.
- Once verification is confirmed in writing ("completed and verified", "verified by [authority]", "clearance letter received"), the finding is **Resolved**.

## Reportable Supplier Criteria

A supplier is reportable and must appear in the roll-up **if and only if** it has at least one finding that is **simultaneously** High severity and Open status.

A supplier that has High-severity findings which are all Resolved does **not** qualify. A supplier that has Open findings which are all Medium or Low severity does **not** qualify.

Where a finding has been re-assessed after the initial audit entry, the **most recent re-assessment supersedes the earlier entry** for that finding. A finding escalated to High severity in a re-assessment, with status still Open, counts as a High+Open finding. Conversely, a finding re-graded and also confirmed as Resolved in the same re-assessment is no longer Open.

## Roll-Up Document

Create a new Google Docs document titled exactly:

    Q2 Supplier Risk Roll-Up

Place it in the root of the workspace (not inside the audit folder).

## Required Content

The document must contain, in order:

1. A heading line: `Q2 Supplier Risk Roll-Up`
2. A line: `Prepared: 2026-Q2`
3. One entry per qualifying supplier, in the following format (one supplier per line):

   `<Supplier Name> | High+Open: <count> | Top finding: <text>`

   where:
   - `<Supplier Name>` is the supplier's name exactly as it appears in that supplier's audit document title.
   - `<count>` is the total number of findings in that document that are both High severity and Open status (after applying any re-assessments).
   - `<text>` is a concise description of the single most critical open High finding — use the first High+Open finding listed in the document (after applying re-assessments; the re-assessment verdict line for that finding counts as its description if escalated).

## MCP Endpoint

    http://127.0.0.1:3081/mcp

JSON-RPC with methods `tools/list` and `tools/call`. All operations through this endpoint from the terminal.

## Useful Tools

- `drive.files.list` / `search_drive_files` — list files, filter with q DSL (e.g. `'<folderId>' in parents`)
- `docs.documents.get` / `get_doc_content` — read a document's full content
- `docs.documents.create` / `create_doc` — create a new document (returns `documentId`)
- `docs.documents.batchUpdate` — add content via `insertText` at index 1
