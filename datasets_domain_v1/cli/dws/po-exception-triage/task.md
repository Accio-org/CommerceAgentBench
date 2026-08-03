NorthBridge Accessories' supply chain team tracks purchase orders in the DingTalk Docs knowledge base — the `Active POs` folder has one document per PO. A batch of POs has developed exceptions that need to be triaged per company procedure.

The `dws` CLI is available for all document operations — authenticate first with the credentials in `workspace/credentials.txt`. Run `dws --help` to see available commands. No network access.

How to identify POs with exceptions, the severity classification rules, what triage actions to take per severity, and the triage report format are all defined in `workspace/triage_procedure.md` — **read it before starting**.

Walk through every PO document under `Active POs`, judge exceptions based on document content (**not just the status field**), and follow the triage procedure for each. The knowledge base state IS the deliverable.
