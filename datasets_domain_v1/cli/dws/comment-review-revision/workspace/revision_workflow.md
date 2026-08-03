# Listing Review Process

## Which comments to process

Only process **unresolved** comments. Resolved comments have already been handled — skip them.

## Comment types

Comments fall into these categories based on their content:

1. **Actionable fix** — the comment requests a specific change (price correction, add a field, fix availability). Apply the change to the document content, then reply to the comment confirming the fix.

2. **Question** — the comment asks a question but does not request a change (e.g., "Is this the correct category?"). Reply with a confirmation or clarification. Do not modify the document.

3. **Approval** — the comment confirms something is correct (e.g., "Looks good"). These are already resolved — skip them.

## How to reply

Reply to each processed comment with a brief confirmation, for example:
- For a fix: "Fixed — [what was changed]"
- For a question: "Confirmed — [answer]"

## What to update

When a comment requests a specific change (e.g., "Price should be X"), update the document content to reflect the change. Use full document overwrite to save changes — preserve all other fields.

## Revision log

After processing all comments, create a document named **Revision Log** under the root folder:

```
# Revision Log

Date: 2026-06-03
Processor: Listing Ops

## Changes Applied
| Listing (SKU) | Change | Comment Author |
|--------------|--------|----------------|
| NB-XX-XXX-001 | Updated price to 21.47 | reviewer-a |
...

## Questions Answered
| Listing (SKU) | Question | Response |
|--------------|----------|----------|
...

Total comments processed: <N>
Changes applied: <N>
Questions answered: <N>
Skipped (resolved): <N>
```
