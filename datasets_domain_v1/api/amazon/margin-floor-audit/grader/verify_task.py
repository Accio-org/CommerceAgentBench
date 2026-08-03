#!/usr/bin/env python3
"""Verifier for api-amazon-margin-floor-audit, API-workflow edition.

This task is graded on correct SP-API mechanics: Listings PATCH validation and
application, Reports polling/document retrieval, Feeds upload/submission/polling,
and evidence preservation. It intentionally avoids profitability math.

Capacity refactor: the original success path emitted 46 atomic checks, and the
feed-message loop could shrink the denominator when a message was missing. The
atomic predicates are still evaluated, but the emitted checks are folded into
stable SP-API capability groups by pure AND aggregation. Binary pass is
unchanged: all capability groups pass iff every atom passes.
"""

import argparse
import json
import os
import urllib.request
from pathlib import Path


def chk(cid, passed, reason=""):
    return {
        "id": cid,
        "passed": bool(passed),
        "reason": str(reason)[:300],
        "check_type": "deterministic_exact",
    }


def fetch_json(url, token):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def norm_price(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return None


def load_json(path):
    try:
        # utf-8-sig tolerates a UTF-8 BOM in agent-produced files.
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def uploaded_json(feed_documents, doc_id):
    doc = feed_documents.get(str(doc_id), {})
    raw = doc.get("_uploadedContent")
    if not isinstance(raw, str):
        return None, "uploaded content missing"
    try:
        return json.loads(raw), ""
    except Exception as e:  # noqa: BLE001
        return None, f"uploaded content is not JSON: {e}"


def message_price(message):
    for patch in message.get("patches", []) if isinstance(message, dict) else []:
        if patch.get("op") != "replace":
            continue
        if patch.get("path") != "/attributes/purchasable_offer":
            continue
        value = patch.get("value")
        try:
            return norm_price(value[0]["our_price"][0]["schedule"][0]["value_with_tax"])
        except (TypeError, KeyError, IndexError):
            return None
    return None


def feed_submission_matches_uploaded(feed_submission, uploaded):
    if not isinstance(uploaded, dict):
        return False
    body = feed_submission_body(feed_submission)
    if body == uploaded:
        return True
    return False


def feed_submission_body(feed_submission):
    if not isinstance(feed_submission, dict):
        return feed_submission
    if "header" in feed_submission and "messages" in feed_submission:
        return feed_submission
    for key in ("feedBody", "uploadedFeedBody", "uploaded_body", "feed_body", "body"):
        value = feed_submission.get(key)
        if isinstance(value, dict):
            return value
    return feed_submission


def deep_values(obj, keys):
    found = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in keys:
                found.append(value)
            found.extend(deep_values(value, keys))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(deep_values(item, keys))
    return found


def feed_submission_refs(feed_submission, keys):
    refs = []
    for value in deep_values(feed_submission, set(keys)):
        if isinstance(value, str):
            refs.append(value)
    return refs


def feed_matches_expected(feed, expected):
    return (
        isinstance(feed, dict)
        and feed.get("feedType") == expected["feed_type"]
        and feed.get("marketplaceIds") == [expected["marketplace_id"]]
    )


def select_feed(feeds, feed_docs, expected, feed_submission):
    candidates = [f for f in feeds.values() if feed_matches_expected(f, expected)]
    if not candidates:
        return None, "no matching feed"

    feed_ids = set(feed_submission_refs(feed_submission, {"feedId"}))
    for feed in candidates:
        if str(feed.get("feedId")) in feed_ids:
            return feed, "matched feed_submission feedId"

    doc_ids = set(feed_submission_refs(feed_submission, {"inputFeedDocumentId", "feedDocumentId"}))
    for feed in candidates:
        if str(feed.get("inputFeedDocumentId")) in doc_ids:
            return feed, "matched feed_submission inputFeedDocumentId"

    submitted_body = feed_submission_body(feed_submission)
    if isinstance(submitted_body, dict):
        for feed in candidates:
            uploaded, _err = uploaded_json(feed_docs, feed.get("inputFeedDocumentId"))
            if uploaded == submitted_body:
                return feed, "matched feed_submission uploaded body"

    done = [f for f in candidates if f.get("processingStatus") == "DONE"]
    if len(done) == 1:
        return done[0], "only DONE matching feed"

    def created_time(feed):
        return str(feed.get("createdTime") or "")

    ordered = sorted(done or candidates, key=created_time)
    return ordered[-1], "latest matching feed"


def listing_key(expected, sku):
    return f"{expected['seller_id']}:{expected['marketplace_id']}:{sku}"


def listing_record(state, expected, sku):
    listings = state.get("listings", {}) if isinstance(state, dict) else {}
    key = listing_key(expected, sku)
    if key in listings:
        return listings[key]
    for record in listings.values():
        if (
            isinstance(record, dict)
            and record.get("sellerId") == expected["seller_id"]
            and record.get("marketplaceId") == expected["marketplace_id"]
            and record.get("sku") == sku
        ):
            return record
    return None


def listing_price(record):
    try:
        offer = record["attributes"]["purchasable_offer"][0]
        return norm_price(offer["our_price"][0]["schedule"][0]["value_with_tax"])
    except (TypeError, KeyError, IndexError):
        return None


def preview_status_map(preview):
    statuses = {}

    def add_status(sku, status):
        if isinstance(sku, str) and isinstance(status, str):
            statuses[sku] = status

    def add_from_item(item, default_sku=None):
        if not isinstance(item, dict):
            return
        sku = item.get("sku") or default_sku
        status = item.get("status")
        for key in ("preview_response", "previewResponse", "validationPreview", "response"):
            response = item.get(key)
            if isinstance(response, dict):
                add_status(response.get("sku") or sku, response.get("status") or status)
        add_status(sku, status)

    def add_from_list(items):
        for item in items:
            add_from_item(item)

    if isinstance(preview, dict):
        preview_containers = (
            "previews",
            "previewResponses",
            "preview_results",
            "validation_previews",
            "validationPreviews",
            "responses",
            "items",
            "results",
        )
        saw_container = False
        for key in preview_containers:
            if isinstance(preview.get(key), list):
                add_from_list(preview[key])
                saw_container = True
        if saw_container:
            return statuses

        for sku, value in preview.items():
            if isinstance(value, str):
                statuses[str(sku)] = value
            else:
                add_from_item(value, str(sku))
    elif isinstance(preview, list):
        add_from_list(preview)

    return statuses


def skipped_updates_map(skipped):
    skipped_map = {}

    def add_items(items):
        for item in items:
            if isinstance(item, dict) and "sku" in item:
                skipped_map[str(item["sku"])] = str(item.get("reason", ""))

    if isinstance(skipped, dict):
        for key in ("skipped", "skipped_updates", "updates", "items", "results"):
            if isinstance(skipped.get(key), list):
                add_items(skipped[key])
                return skipped_map
        skipped_map = {str(k): str(v) for k, v in skipped.items()}
    elif isinstance(skipped, list):
        add_items(skipped)

    return skipped_map


def audit_entries(audit):
    if not isinstance(audit, dict):
        return []
    entries = audit.get("entries", [])
    return [e for e in entries if isinstance(e, dict) and e.get("ctx", {}).get("actor") != "seed"]


def has_audit(entries, entity_type, op, predicate=lambda _payload: True):
    for entry in entries:
        if entry.get("entityType") != entity_type or entry.get("op") != op:
            continue
        payload = entry.get("payload")
        if isinstance(payload, dict) and predicate(payload):
            return True
    return False


def fold_atoms(atoms, group_specs):
    atom_ids = set(atoms)
    mapped = []
    for _gid, _desc, members in group_specs:
        mapped.extend(members)

    missing = [aid for aid in mapped if aid not in atom_ids]
    extra = sorted(atom_ids - set(mapped))
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing atom ids: {missing}")
        if extra:
            details.append(f"unmapped atom ids: {extra}")
        raise AssertionError("; ".join(details))

    folded = []
    for gid, desc, members in group_specs:
        member_checks = [atoms[aid] for aid in members]
        failed = [c for c in member_checks if not c["passed"]]
        ok = not failed
        if ok:
            reason = f"ok ({len(member_checks)} atoms)"
        else:
            reason = "failed atoms -> " + "; ".join(
                f"{c['id']}: {c['reason']}" for c in failed
            )
        item = chk(gid, ok, reason)
        item["description"] = desc
        item["atoms"] = member_checks
        folded.append(item)
    return folded


def group_specs(patch_skus, feed_skus):
    patch_atoms = ["patch_preview_saved"]
    for sku in patch_skus:
        patch_atoms.extend([
            f"patch_preview::{sku}",
            f"listing_patch_applied::{sku}",
            f"audit_listing_patch::{sku}",
        ])

    feed_body_atoms = [
        "feed_header_seller",
        "feed_exact_sku_set",
        "patch_rows_not_in_feed",
        "feed_message_ids_sequential",
    ]
    for sku in feed_skus:
        feed_body_atoms.extend([
            f"message::{sku}",
            f"operation::{sku}",
            f"product_type::{sku}",
            f"price::{sku}",
        ])

    return [
        (
            "setup_gate",
            "Verifier can read the mock SP-API final state and audit log.",
            ["mock_reachable", "audit_reachable"],
        ),
        (
            "patch_channel_completed",
            "Valid PATCH-channel rows were previewed, applied, and audited.",
            patch_atoms,
        ),
        (
            "settlement_report_completed",
            "Settlement report was created, polled to DONE, documented, and audited.",
            [
                "report_created",
                "report_done",
                "report_polled",
                "report_document_created",
                "audit_report_submit",
            ],
        ),
        (
            "settlement_sample_saved",
            "Downloaded settlement report evidence was saved as readable TSV.",
            ["settlement_sample_saved"],
        ),
        (
            "feed_state_machine_completed",
            "JSON_LISTINGS_FEED was submitted, polled to DONE, and audited.",
            [
                "feed_created",
                "feed_done",
                "feed_result_document_created",
                "audit_feed_submit",
            ],
        ),
        (
            "feed_document_uploaded",
            "Feed document slot was created with JSON content and uploaded.",
            [
                "feed_uses_uploaded_document",
                "feed_document_content_type",
                "audit_feed_document_upload",
                "feed_upload_json_parseable",
            ],
        ),
        (
            "feed_body_correct",
            "Uploaded JSON feed contains the correct seller header, SKU set, and price patches.",
            feed_body_atoms,
        ),
        (
            "invalid_rows_skipped",
            "Invalid approval rows were skipped with the expected reason codes.",
            ["skipped_updates_recorded"],
        ),
        (
            "final_feed_evidence_saved",
            "Feed processing report and submitted feed artifact were preserved.",
            ["feed_processing_report_saved", "feed_submission_artifact_matches_upload"],
        ),
    ]


def evaluate(expected, state, audit, output_dir, state_err="", audit_err=""):
    atoms = {}

    def add(cid, passed, reason=""):
        atoms[cid] = chk(cid, passed, reason)

    sfx = f" ({state_err})" if state_err else ""
    ok_state = isinstance(state, dict) and bool(state) and not state_err
    ok_audit = isinstance(audit, dict) and not audit_err
    add("mock_reachable", ok_state, state_err or "bench state reachable")
    add("audit_reachable", ok_audit, audit_err or "bench audit reachable")

    reports = state.get("reports", {}) if isinstance(state, dict) else {}
    report_docs = state.get("reportDocuments", {}) if isinstance(state, dict) else {}
    feeds = state.get("feeds", {}) if isinstance(state, dict) else {}
    feed_docs = state.get("feedDocuments", {}) if isinstance(state, dict) else {}
    entries = audit_entries(audit)

    patch_by_sku = {x["sku"]: norm_price(x["new_price"]) for x in expected["patch_updates"]}
    feed_by_sku = {x["sku"]: norm_price(x["new_price"]) for x in expected["feed_updates"]}

    preview = load_json(output_dir / "listings_patch_preview.json")
    preview_statuses = preview_status_map(preview)
    add("patch_preview_saved", bool(preview_statuses), "expected saved validation preview responses")
    feed_submission = load_json(output_dir / "feed_submission.json")

    for sku, price in patch_by_sku.items():
        add(f"patch_preview::{sku}", preview_statuses.get(sku) == "VALID",
            f"expected VALID preview for {sku}, got {preview_statuses.get(sku)}")
        record = listing_record(state, expected, sku)
        got_price = listing_price(record) if record else None
        add(f"listing_patch_applied::{sku}", got_price == price,
            f"expected final listing price {price}, got {got_price}")
        key = listing_key(expected, sku)
        add(
            f"audit_listing_patch::{sku}",
            has_audit(entries, "listing", "patch", lambda p, k=key: p.get("_storeKey") == k),
            f"expected non-seed listing patch audit entry for {sku}",
        )

    report = next(
        (
            r for r in reports.values()
            if r.get("reportType") == expected["report_type"]
            and r.get("marketplaceIds") == [expected["marketplace_id"]]
        ),
        None,
    )
    add("report_created", report is not None, f"expected reportType {expected['report_type']}{sfx}")
    add("report_done", bool(report) and report.get("processingStatus") == "DONE",
        f"expected settlement report DONE, got {report and report.get('processingStatus')}{sfx}")
    add("report_polled", bool(report) and int(report.get("_pollCount") or 0) >= 2,
        f"expected report to be polled to completion, got pollCount={report and report.get('_pollCount')}{sfx}")
    report_doc_id = report.get("reportDocumentId") if report else None
    add("report_document_created", bool(report_doc_id) and str(report_doc_id) in report_docs,
        f"missing report document {report_doc_id}{sfx}")
    add(
        "audit_report_submit",
        has_audit(entries, "report", "submit", lambda p: p.get("reportType") == expected["report_type"]),
        "expected report submit audit entry",
    )

    settlement_sample = output_dir / "settlement_report_sample.tsv"
    sample_text = settlement_sample.read_text(errors="ignore") if settlement_sample.exists() else ""
    add("settlement_sample_saved", "settlement-id" in sample_text and "\t" in sample_text,
        "expected readable TSV sample with settlement-id header")

    feed, feed_selection_reason = select_feed(feeds, feed_docs, expected, feed_submission)
    add("feed_created", feed is not None,
        f"expected feedType {expected['feed_type']} ({feed_selection_reason}){sfx}")
    add("feed_done", bool(feed) and feed.get("processingStatus") == "DONE",
        f"expected feed DONE, got {feed and feed.get('processingStatus')}{sfx}")
    add("feed_result_document_created",
        bool(feed) and bool(feed.get("resultFeedDocumentId")) and str(feed.get("resultFeedDocumentId")) in feed_docs,
        f"missing feed result document for feed {feed and feed.get('feedId')}{sfx}")
    add(
        "audit_feed_submit",
        has_audit(entries, "feed", "submit", lambda p: p.get("feedType") == expected["feed_type"]),
        "expected feed submit audit entry",
    )

    input_doc_id = feed.get("inputFeedDocumentId") if feed else None
    input_doc = feed_docs.get(str(input_doc_id), {}) if input_doc_id else {}
    add("feed_uses_uploaded_document", bool(input_doc),
        f"feed inputFeedDocumentId {input_doc_id} not found{sfx}")
    add("feed_document_content_type",
        input_doc.get("contentType") == expected["feed_content_type"],
        f"expected contentType {expected['feed_content_type']}, got {input_doc.get('contentType')}{sfx}")
    add(
        "audit_feed_document_upload",
        has_audit(entries, "feed_document", "store_upload", lambda p: p.get("feedDocumentId") == input_doc_id),
        "expected feed document upload audit entry",
    )

    uploaded, upload_err = uploaded_json(feed_docs, input_doc_id)
    add("feed_upload_json_parseable", isinstance(uploaded, dict), upload_err)
    expected_skus = sorted(feed_by_sku)

    messages = uploaded.get("messages") if isinstance(uploaded, dict) else None
    message_items = messages if isinstance(messages, list) else []
    msg_by_sku = {}
    for m in message_items:
        if isinstance(m, dict) and isinstance(m.get("sku"), str):
            msg_by_sku[m["sku"]] = m

    add("feed_header_seller",
        isinstance(uploaded, dict)
        and uploaded.get("header", {}).get("sellerId") == expected["seller_id"]
        and uploaded.get("header", {}).get("version") == "2.0",
        "expected JSON_LISTINGS_FEED header sellerId/version")
    add("feed_exact_sku_set", sorted(msg_by_sku) == expected_skus,
        f"expected feed SKUs {expected_skus}, got {sorted(msg_by_sku)}")
    add("patch_rows_not_in_feed",
        not (set(msg_by_sku) & set(patch_by_sku)),
        f"PATCH rows must not be duplicated in feed, got overlap {sorted(set(msg_by_sku) & set(patch_by_sku))}")
    add("feed_message_ids_sequential",
        [m.get("messageId") if isinstance(m, dict) else None for m in message_items]
        == list(range(1, len(message_items) + 1)),
        "messageId values must be 1..N in order")

    for sku, price in feed_by_sku.items():
        msg = msg_by_sku.get(sku)
        add(f"message::{sku}", bool(msg), f"missing feed message for {sku}")
        add(f"operation::{sku}", isinstance(msg, dict) and msg.get("operationType") == "PATCH",
            f"expected PATCH, got {msg.get('operationType') if isinstance(msg, dict) else None}")
        add(f"product_type::{sku}", isinstance(msg, dict) and msg.get("productType") == "CE_ACCESSORY",
            f"expected CE_ACCESSORY, got {msg.get('productType') if isinstance(msg, dict) else None}")
        got_price = message_price(msg)
        add(f"price::{sku}", got_price == price, f"expected new price {price}, got {got_price}")

    skipped = load_json(output_dir / "skipped_price_updates.json")
    skipped_map = skipped_updates_map(skipped)
    add("skipped_updates_recorded",
        skipped_map == expected["skipped_updates"],
        f"expected skipped map {expected['skipped_updates']}, got {skipped_map}")

    processing_report = output_dir / "feed_processing_report.xml"
    pr_text = processing_report.read_text(errors="ignore") if processing_report.exists() else ""
    add("feed_processing_report_saved",
        "<StatusCode>Complete</StatusCode>" in pr_text
        and "<MessagesSuccessful>1</MessagesSuccessful>" in pr_text,
        "expected downloaded feed processing report XML")

    add("feed_submission_artifact_matches_upload",
        feed_submission_matches_uploaded(feed_submission, uploaded),
        "outputs/feed_submission.json should preserve the uploaded feed JSON, directly or under a feed-body wrapper")

    return fold_atoms(atoms, group_specs(sorted(patch_by_sku), expected_skus))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    a = ap.parse_args()

    task = Path(a.task_dir)
    output_dir = Path(a.output_dir)
    expected = json.loads((task / "private/expected_answer.json").read_text(encoding="utf-8-sig"))

    mock_url = os.environ.get("MOCK_SITE_URL", "").rstrip("/")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "bench-verifier")
    state, state_err = {}, ""
    audit, audit_err = {}, ""
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
        audit_err = "MOCK_SITE_URL not set"
    else:
        try:
            state = fetch_json(f"{mock_url}/__bench/state", token)
        except Exception as e:  # noqa: BLE001
            state_err = f"state fetch failed: {e}"
        try:
            audit = fetch_json(f"{mock_url}/__bench/audit", token)
        except Exception as e:  # noqa: BLE001
            audit_err = f"audit fetch failed: {e}"

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "mock_amazon_final_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (output_dir / "mock_amazon_audit.json").write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass

    checks = evaluate(expected, state, audit, output_dir, state_err, audit_err)
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    reward = round(passed / total, 4) if total else 0.0
    out = {
        "schema_version": "2.0",
        "task_id": task.name,
        "score": reward,
        "reward": reward,
        "raw_score": reward,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "diagnostics": {
            "atomic_breakdown": [
                {"id": atom["id"], "passed": atom["passed"], "reason": atom["reason"], "group": group["id"]}
                for group in checks
                for atom in group.get("atoms", [])
            ],
        },
        "passed": passed == total,
        "source": "v2_capacity_folded",
    }
    Path(a.reward_json).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"score": reward, "checks_passed": passed, "checks_total": total,
                      "passed": passed == total}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
