#!/usr/bin/env python3
"""Verifier for cli-xfer-customs-freight-anomaly-trace.

Reads three final mock states:
  - dws_doc_cli  : MOCK_SITE_URL_DWS_DOC_CLI/api/state
  - stripe_cli   : MOCK_SITE_URL_STRIPE_CLI/api/state
  - box_cli      : MOCK_SITE_URL_BOX_CLI/api/state

Scoring is based on the final state the agent produced in the three CLI
systems, compared against pre-computed ground truth from the customs CSVs
and designed workspace files (shipping manifests with intentional errors).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(v: Any) -> str:
    return " ".join(str(v or "").strip().casefold().split())


def _fetch(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _read_state(env_names: tuple[str, ...], token: str,
                 state_path: str = "/api/state") -> tuple[dict[str, Any], str]:
    for env in env_names:
        base = os.environ.get(env, "").rstrip("/")
        if not base:
            continue
        if not token:
            return {}, "MOCK_VERIFIER_TOKEN not set"
        try:
            return _fetch(f"{base}{state_path}", token), ""
        except Exception as exc:  # noqa: BLE001
            return {}, f"{env}: {exc}"
    return {}, f"none of {', '.join(env_names)} set"


def chk(cid: str, ok: bool, reason: str = "") -> dict[str, Any]:
    return {"id": cid, "passed": bool(ok), "reason": str(reason)[:700],
            "check_type": "deterministic_exact"}


# ---------------------------------------------------------------------------
# DWS helpers
# ---------------------------------------------------------------------------

def _dws_entities(state: dict[str, Any], entity: str) -> list[dict[str, Any]]:
    raw = (state.get("entities") or {}).get(entity) or {}
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, list):
        return raw
    return []


def _dws_content_text(doc: dict[str, Any]) -> str:
    parts: list[str] = []
    parts.append(str(doc.get("content") or ""))
    parts.append(str(doc.get("name") or doc.get("title") or ""))
    for block in doc.get("blocks") or []:
        parts.append(str(block.get("text") or block.get("content") or ""))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Stripe helpers
# ---------------------------------------------------------------------------

def _stripe_objects(state: dict[str, Any], resource: str) -> list[dict[str, Any]]:
    return [o.get("data") or o for o in state.get("objects", [])
            if o.get("resource") == resource]


# ---------------------------------------------------------------------------
# Box helpers
# ---------------------------------------------------------------------------


def _box_folders(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("folders", [])


def _box_files(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("files", [])


def _box_comments(state: dict[str, Any]) -> list[dict[str, Any]]:
    return state.get("comments", [])


# ---------------------------------------------------------------------------
# Root-cause keyword matching
# ---------------------------------------------------------------------------

_RC_KEYWORDS: dict[str, list[str]] = {
    "VOLUME_GROWTH": [
        "volume_growth", "volume growth", "业务增长", "出货量增长",
        "shipment increase", "legitimate growth", "正常增长",
        "volume increase", "出货增长", "业务量增长", "增长",
        "shipments doubled", "shipment count increase", "more shipments",
        "volume grew", "business growth",
    ],
    "WEIGHT_TYPO": [
        "weight_typo", "weight typo", "重量录入错误", "重量错误",
        "decimal error", "weight error", "weight discrepancy",
        "重量不符", "重量偏差", "申报重量", "小数点",
        "清单重量错误",
        "data entry error", "data-entry error", "mis-keyed", "miskeyed",
        "decimal point", "decimal shift",
        "extra zero", "transcription error", "typo", "wrong weight",
    ],
    "RATE_CHANGE": [
        "rate_change", "rate change", "费率变更", "rate increase",
        "费率上调", "费率调整", "运费费率变更", "rate adjustment",
        "费率增长", "费率提高",
        "fuel surcharge", "new rate", "tariff increase",
    ],
}


_RC_CODE_LINE_RE = re.compile(r"root\s*cause\s*code[^\n]*", re.IGNORECASE)
_RC_CODE_RE = re.compile(r"\b(VOLUME_GROWTH|WEIGHT_TYPO|RATE_CHANGE)\b", re.IGNORECASE)


def _detect_root_cause_code(text: str) -> str | None:
    """Parse explicit `Root Cause Code` line(s) from the report.

    A line counts only when it names exactly one of the three codes (a verbatim
    unfilled template line listing all three is ignored). If the valid code
    lines agree on a single code, return it; if they conflict, return the
    sentinel "CONFLICT" (callers treat it as an explicit-but-wrong answer —
    no keyword fallback). Returns None when no valid code line exists.
    """
    distinct: set[str] = set()
    for m in _RC_CODE_LINE_RE.finditer(text):
        codes = {c.upper() for c in _RC_CODE_RE.findall(m.group(0))}
        if len(codes) == 1:
            distinct.add(codes.pop())
    if not distinct:
        return None
    if len(distinct) == 1:
        return distinct.pop()
    return "CONFLICT"


def _detect_root_cause(text: str) -> str | None:
    """Detect root cause from document text.

    Prefers an explicit `Root Cause Code: <CODE>` line (exact code match);
    falls back to keyword scoring only when no code line is present.
    """
    explicit = _detect_root_cause_code(text)
    if explicit is not None:
        return explicit
    # The investigation template's own "Rate changed:" field answered "No"
    # (or left unfilled as "[Yes/No]") is NOT evidence of a RATE_CHANGE root
    # cause — drop those lines before keyword scoring so the template
    # scaffolding cannot false-trigger. A clear "Rate changed: Yes" is kept.
    kept_lines: list[str] = []
    for line in text.split("\n"):
        m = re.search(r"rate\s*changed\s*[:：]\s*(.*)", line, re.IGNORECASE)
        if m and not re.match(r"^\**\s*yes\b", m.group(1).strip(), re.IGNORECASE):
            continue
        kept_lines.append(line)
    text_lower = "\n".join(kept_lines).lower()
    scores: dict[str, int] = {}
    for rc, keywords in _RC_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw.lower() in text_lower)
        if count > 0:
            scores[rc] = count
    if not scores:
        return None
    return max(scores, key=scores.get)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Stripe customer → supplier matching (deterministic two-pass)
# ---------------------------------------------------------------------------

_STRIPE_MATCH_STOPWORDS = {"CO", "LTD", "THE", "AND", "INC", "LLC", "CORP"}


def _match_stripe_customers_to_suppliers(
    customers: list[dict[str, Any]],
    supplier_names: set[str],
) -> dict[str, dict[str, Any]]:
    """Map each supplier name to its Stripe customer using deterministic two-pass.

    Pass 1: full-name containment — for each customer, collect all suppliers
    whose full normalised name is contained in the customer name; if >= 1 match,
    pick the longest matched supplier name (longest → most specific → deterministic).

    Pass 2 (only for unmatched suppliers): word-overlap scoring over
    sorted(supplier_names). Significant words: len > 4 and not in stopwords.
    Qualify with >= 2 distinct shared words, or one shared word unique to this
    supplier across all supplier names; rank by (shared count, has unique),
    alphabetical tie-break. No set-order dependence: everything is sorted.
    """
    cust_by_supplier: dict[str, dict[str, Any]] = {}
    unmatched_suppliers = sorted(supplier_names)  # deterministic order

    # Pass 1: full normalised name containment
    remaining: list[str] = []
    for supplier in unmatched_suppliers:
        norm_s = _norm(supplier)
        best_cust: dict[str, Any] | None = None
        # Sort customers by name for determinism if multiple customers match
        for cust in sorted(customers, key=lambda c: str(c.get("name") or "")):
            cname = str(cust.get("name") or "")
            norm_cname = _norm(cname)
            if supplier in cname or norm_s in norm_cname:
                # Track best match; since we want the supplier with longest name
                # matched, just record this customer (pass-1: first full match wins
                # because this supplier's full name is contained → unambiguous)
                best_cust = cust
                break
        if best_cust is not None:
            cust_by_supplier[supplier] = best_cust
        else:
            remaining.append(supplier)

    # Pass 2: word-overlap scoring for remaining unmatched suppliers.
    # A customer qualifies with >= 2 shared significant words, OR with a single
    # shared word that is unique to this supplier across all supplier names
    # (e.g. a bare "PERLOVE" customer). Words shared between suppliers, like
    # MEDICAL, can never qualify alone — that single-word matching is what made
    # the old implementation order-dependent.
    token_freq: dict[str, int] = {}
    for s in sorted(supplier_names):
        for w in {w.upper() for w in s.split()
                  if len(w) > 4 and w.upper() not in _STRIPE_MATCH_STOPWORDS}:
            token_freq[w] = token_freq.get(w, 0) + 1

    for supplier in remaining:
        s_words = {
            w.upper() for w in supplier.split()
            if len(w) > 4 and w.upper() not in _STRIPE_MATCH_STOPWORDS
        }
        if not s_words:
            continue
        unique_words = {w for w in s_words if token_freq.get(w) == 1}

        best_cust = None
        best_key = (0, 0)  # (shared word count, shares a unique word)
        best_cname = ""

        for cust in sorted(customers, key=lambda c: str(c.get("name") or "")):
            cname = str(cust.get("name") or "")
            c_words = {
                w.upper() for w in cname.split()
                if len(w) > 4 and w.upper() not in _STRIPE_MATCH_STOPWORDS
            }
            shared = s_words & c_words
            has_unique = bool(shared & unique_words)
            if len(shared) < 2 and not has_unique:
                continue
            key = (len(shared), int(has_unique))
            if (best_cust is None or key > best_key
                    or (key == best_key and cname < best_cname)):
                best_key = key
                best_cust = cust
                best_cname = cname

        if best_cust is not None:
            cust_by_supplier[supplier] = best_cust

    return cust_by_supplier


# ---------------------------------------------------------------------------
# Box folder → supplier matching (deterministic two-pass)
# ---------------------------------------------------------------------------

_BOX_MATCH_STOPWORDS = {"CO", "LTD", "THE", "AND"}


def _match_box_folders_to_suppliers(
    folders: list[dict[str, Any]],
    supplier_names: set[str],
) -> dict[str, list[dict[str, Any]]]:
    """Map each supplier name to matching Box folders using deterministic two-pass.

    Pass 1 (full name): if a folder's name fully contains the normalised supplier
    name, append only those folders (one-to-many: a folder may match multiple
    suppliers if names are substrings of each other; that is intentional).

    Pass 2 (word overlap): for suppliers still unmatched, fall back to partial
    word match — >= 2 significant words, or a single word unique to this
    supplier across all supplier names. Sorted iteration for determinism.
    """
    supplier_folders: dict[str, list[dict[str, Any]]] = {s: [] for s in supplier_names}

    box_token_freq: dict[str, int] = {}
    for s in sorted(supplier_names):
        for w in {w.upper() for w in s.split()
                  if len(w) > 3 and w.upper() not in _BOX_MATCH_STOPWORDS}:
            box_token_freq[w] = box_token_freq.get(w, 0) + 1

    for supplier in sorted(supplier_names):
        norm_s = _norm(supplier)

        # Pass 1: full name containment
        full_matches: list[dict[str, Any]] = []
        for folder in sorted(folders, key=lambda f: str(f.get("name") or "")):
            fname = str(folder.get("name") or "")
            if supplier in fname or norm_s in _norm(fname):
                full_matches.append(folder)

        if full_matches:
            supplier_folders[supplier].extend(full_matches)
            continue

        # Pass 2: >= 2 significant word matches, or one word unique to this
        # supplier (a folder named just "PERLOVE evidence" matches PERLOVE;
        # an ambiguous "MEDICAL evidence" folder matches nobody).
        s_parts = supplier.split()
        sig_parts = [
            p for p in s_parts
            if len(p) > 3 and p.upper() not in _BOX_MATCH_STOPWORDS
        ]
        if not sig_parts:
            continue

        for folder in sorted(folders, key=lambda f: str(f.get("name") or "")):
            fname = str(folder.get("name") or "")
            matched = [p for p in sig_parts if p.lower() in fname.lower()]
            has_unique = any(box_token_freq.get(p.upper()) == 1 for p in matched)
            if len(matched) >= 2 or has_unique:
                supplier_folders[supplier].append(folder)

    return supplier_folders


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate(exp: dict[str, Any],
             dws: dict[str, Any], stripe: dict[str, Any], box: dict[str, Any],
             dws_err: str, stripe_err: str, box_err: str,
             source_ok: bool, source_reason: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    all_suppliers = exp["suppliers"]
    supplier_names = {s["supplier"] for s in all_suppliers}
    wt_typo_suppliers = set(exp["weight_typo_suppliers"])
    no_adj_suppliers = set(exp["stripe_no_adjustment_suppliers"])

    # ======================================================================
    # Check 1: setup_gate — all 3 CLIs accessible
    # ======================================================================
    setup_ok = not dws_err and not stripe_err and not box_err
    setup_reason = dws_err or stripe_err or box_err or "ok"
    checks.append(chk("setup_gate", setup_ok, setup_reason))

    # ======================================================================
    # Check 2: source_data_present — CSV files exist
    # ======================================================================
    checks.append(chk("source_data_present", source_ok, source_reason))

    if not setup_ok:
        for cid in ("dws_investigation_reports", "dws_content_correct",
                     "box_evidence_archive", "box_corrections_noted",
                     "stripe_adjustments_correct", "causal_chain_accuracy"):
            checks.append(chk(cid, False, "setup_gate failed"))
        return checks

    # ------------------------------------------------------------------
    # Gather DWS documents
    # ------------------------------------------------------------------
    dws_docs = _dws_entities(dws, "documents")

    # Map each supplier to the DWS doc(s) that mention it
    supplier_docs: dict[str, list[dict[str, Any]]] = {s: [] for s in supplier_names}
    for doc in dws_docs:
        doc_text = _dws_content_text(doc)
        for s in supplier_names:
            if s in doc_text or _norm(s) in _norm(doc_text):
                supplier_docs[s].append(doc)

    # ======================================================================
    # Check 3: dws_investigation_reports
    # ======================================================================
    report_fail: list[str] = []
    for s in supplier_names:
        if not supplier_docs[s]:
            report_fail.append(f"{s}: no investigation doc found")

    checks.append(chk("dws_investigation_reports", not report_fail,
                       "ok" if not report_fail else "; ".join(report_fail[:5])))

    # ======================================================================
    # Check 4: dws_content_correct — key numbers present
    # ======================================================================
    content_fail: list[str] = []
    for spec in all_suppliers:
        s = spec["supplier"]
        docs = supplier_docs.get(s, [])
        if not docs:
            content_fail.append(f"{s}: no doc to check")
            continue
        combined = " ".join(_dws_content_text(d) for d in docs)
        # Build a comma-stripped version so comma-formatted numbers also match
        searchable = combined + " " + combined.replace(",", "")

        # Check CSV weight appears (as integer substring)
        csv_wt_25_str = str(int(spec["csv_weight_2025"]))
        if csv_wt_25_str not in searchable and str(spec["csv_weight_2025"]) not in searchable:
            content_fail.append(f"{s}: 2025 CSV weight {spec['csv_weight_2025']} missing")

        # For weight-typo suppliers, check manifest weight is also mentioned
        if spec["root_cause"] == "WEIGHT_TYPO":
            mw_str = str(int(spec["manifest_weight_2025"]))
            if mw_str not in searchable and str(spec["manifest_weight_2025"]) not in searchable:
                content_fail.append(f"{s}: manifest weight {spec['manifest_weight_2025']} missing")

        # For rate-change supplier, check rates mentioned
        if spec["root_cause"] == "RATE_CHANGE":
            r24 = str(spec["rate_2024"])
            r25 = str(spec["rate_2025"])
            if r24 not in searchable:
                content_fail.append(f"{s}: 2024 rate {r24} missing")
            if r25 not in searchable:
                content_fail.append(f"{s}: 2025 rate {r25} missing")

    checks.append(chk("dws_content_correct", not content_fail,
                       "ok" if not content_fail else "; ".join(content_fail[:6])))

    # ------------------------------------------------------------------
    # Gather Box items
    # ------------------------------------------------------------------
    box_folders_list = _box_folders(box)
    box_files = _box_files(box)
    box_comments = _box_comments(box)

    # Map suppliers to Box folders (deterministic two-pass)
    supplier_folders = _match_box_folders_to_suppliers(box_folders_list, supplier_names)

    # ======================================================================
    # Check 5: box_evidence_archive — folders per supplier
    # ======================================================================
    archive_fail: list[str] = []
    for s in supplier_names:
        if not supplier_folders[s]:
            archive_fail.append(f"{s}: no evidence folder")

    # Also check that files exist in Box (manifests uploaded)
    if len(box_files) < 3:
        archive_fail.append(f"expected 3+ files in Box, got {len(box_files)}")

    checks.append(chk("box_evidence_archive", not archive_fail,
                       "ok" if not archive_fail else "; ".join(archive_fail[:5])))

    # ======================================================================
    # Check 6: box_corrections_noted — comments on weight-typo suppliers
    # ======================================================================
    correction_fail: list[str] = []
    correction_keywords = [
        "correct", "fix", "error", "typo", "修正", "纠正",
        "更正", "错误", "weight", "重量",
    ]

    for wt_supplier in sorted(wt_typo_suppliers):
        # Look for comments on files in this supplier's folder(s)
        folder_ids = set()
        for f in supplier_folders.get(wt_supplier, []):
            fid = str(f.get("id") or "")
            if fid:
                folder_ids.add(fid)

        # Find files in those folders
        supplier_file_ids = set()
        for bf in box_files:
            parent = str(bf.get("parent_id") or "")
            if parent in folder_ids:
                supplier_file_ids.add(str(bf.get("id") or ""))

        # Check for comments on those files, OR any comment mentioning the supplier
        found_comment = False
        for c in box_comments:
            c_text = str(c.get("message") or c.get("text") or c.get("content") or "")
            c_file = str(c.get("item_id") or "")
            # Direct match: comment on a file in the supplier's folder
            if c_file in supplier_file_ids and supplier_file_ids:
                found_comment = True
                break
            # Fallback: comment mentions correction keywords + supplier
            if (wt_supplier in c_text or _norm(wt_supplier) in _norm(c_text)):
                if any(kw in c_text.lower() for kw in correction_keywords):
                    found_comment = True
                    break

        # Even broader fallback: any comment mentioning correction keywords
        # in the context of files that mention the supplier
        if not found_comment:
            for c in box_comments:
                c_text = str(c.get("message") or c.get("text") or
                             c.get("content") or "")
                if any(kw in c_text.lower() for kw in correction_keywords):
                    # Check if the file name references this supplier
                    c_file = str(c.get("item_id") or "")
                    for bf in box_files:
                        if str(bf.get("id") or "") == c_file:
                            bf_name = str(bf.get("name") or "")
                            s_parts = wt_supplier.split()
                            if any(p.lower() in bf_name.lower()
                                   for p in s_parts
                                   if len(p) > 3 and
                                   p.upper() not in {"CO", "LTD"}):
                                found_comment = True
                                break
                    if found_comment:
                        break

        if not found_comment:
            correction_fail.append(f"{wt_supplier}: no correction comment found")

    checks.append(chk("box_corrections_noted", not correction_fail,
                       "ok" if not correction_fail else "; ".join(correction_fail)))

    # ------------------------------------------------------------------
    # Gather Stripe objects
    # ------------------------------------------------------------------
    stripe_customers = _stripe_objects(stripe, "customers")
    stripe_invoices = _stripe_objects(stripe, "invoices")
    stripe_invoice_items = _stripe_objects(stripe, "invoiceitems")
    stripe_prices = _stripe_objects(stripe, "prices")
    stripe_refunds = _stripe_objects(stripe, "refunds")

    # Map Stripe customers to supplier names (deterministic two-pass)
    cust_by_supplier = _match_stripe_customers_to_suppliers(
        stripe_customers, supplier_names
    )

    # ======================================================================
    # Check 7: stripe_adjustments_correct
    # ======================================================================
    stripe_fail: list[str] = []

    # Build a lookup: customer id → list of refunds for that customer.
    # Refunds in the mock reference a charge or payment_intent rather than a
    # customer, so resolve through those objects; metadata.customer also works.
    charge_customer: dict[str, str] = {}
    for obj_type in ("charges", "payment_intents"):
        for obj in _stripe_objects(stripe, obj_type):
            obj_id = str(obj.get("id") or "")
            obj_cust = str(obj.get("customer") or "")
            if obj_id and obj_cust:
                charge_customer[obj_id] = obj_cust

    refunds_by_cust: dict[str, list[dict[str, Any]]] = {}
    for ref in stripe_refunds:
        meta = ref.get("metadata") or {}
        c_id = str(meta.get("customer") or ref.get("customer") or "")
        if not c_id:
            c_id = (charge_customer.get(str(ref.get("charge") or ""))
                    or charge_customer.get(str(ref.get("payment_intent") or ""))
                    or "")
        if c_id:
            refunds_by_cust.setdefault(c_id, []).append(ref)

    # Weight-typo suppliers MUST have Stripe records
    for wt_supplier in sorted(wt_typo_suppliers):
        if wt_supplier not in cust_by_supplier:
            stripe_fail.append(f"{wt_supplier}: no Stripe customer found")
            continue

        cust = cust_by_supplier[wt_supplier]
        cust_id = str(cust.get("id") or "")

        # Check for invoice(s) linked to this customer
        cust_invoices = [inv for inv in stripe_invoices
                         if str(inv.get("customer") or "") == cust_id]
        if not cust_invoices:
            stripe_fail.append(f"{wt_supplier}: no invoice found")
            continue

        # Retrieve expected amount and direction from spec
        spec = next(s for s in all_suppliers if s["supplier"] == wt_supplier)
        expected_amt = spec["stripe_adjustment_amount"]
        expected_dir = spec.get("stripe_adjustment_direction", "")

        # Try to find the amount from invoice items or invoice total
        found_amount = False
        matched_raw_amt: float | None = None  # sign preserved

        if expected_dir == "credit":
            # Pre-scan invoice items AND prices for a genuinely NEGATIVE
            # amount within tolerance. This must run before the
            # description-text fallback: description text always yields
            # positive amounts and would otherwise shadow a real negative
            # line item / price, failing the direction check below.
            cust_invoice_ids = {str(inv.get("id") or "") for inv in cust_invoices}
            neg_candidates: list[float] = []
            for ii in stripe_invoice_items:
                if str(ii.get("invoice") or "") not in cust_invoice_ids:
                    continue
                amt = ii.get("amount") or ii.get("unit_amount") or 0
                try:
                    raw_amt = float(amt)
                except (TypeError, ValueError):
                    continue
                if raw_amt < 0:
                    neg_candidates.append(raw_amt)
            for price in stripe_prices:
                amt = price.get("unit_amount") or price.get("amount") or 0
                try:
                    raw_amt = float(amt)
                except (TypeError, ValueError):
                    continue
                if raw_amt < 0:
                    neg_candidates.append(raw_amt)
            for raw_amt in neg_candidates:
                for divisor in (1, 100):
                    adj = abs(raw_amt) / divisor
                    if abs(adj - expected_amt) / expected_amt < 0.10:
                        found_amount = True
                        matched_raw_amt = raw_amt / divisor
                        break
                if found_amount:
                    break

        for inv in cust_invoices:
            if found_amount:
                break
            inv_id = str(inv.get("id") or "")
            # Check invoice items
            inv_items = [ii for ii in stripe_invoice_items
                         if str(ii.get("invoice") or "") == inv_id]
            for ii in inv_items:
                # unit_amount is in cents in real Stripe, but mock may use dollars
                amt = ii.get("amount") or ii.get("unit_amount") or 0
                try:
                    raw_amt = float(amt)
                    amt_val = abs(raw_amt)
                except (TypeError, ValueError):
                    continue
                # Check if amount matches (could be in cents or dollars)
                # Accept within 10% tolerance
                for divisor in (1, 100):
                    adj = amt_val / divisor
                    if abs(adj - expected_amt) / expected_amt < 0.10:
                        found_amount = True
                        matched_raw_amt = raw_amt / divisor
                        break
                if found_amount:
                    break
            if found_amount:
                break

            # Fallback: check invoice description/metadata for amount
            desc = str(inv.get("description") or inv.get("memo") or "")
            # Try to extract amount from description
            amounts_in_desc = re.findall(r'[\$]?([\d,]+\.?\d*)', desc)
            for amt_str in amounts_in_desc:
                try:
                    amt_val = float(amt_str.replace(",", ""))
                    if abs(amt_val - expected_amt) / expected_amt < 0.10:
                        found_amount = True
                        matched_raw_amt = amt_val  # description is always positive text
                        break
                except ValueError:
                    continue
            if found_amount:
                break

        # Also check prices
        if not found_amount:
            for price in stripe_prices:
                amt = price.get("unit_amount") or price.get("amount") or 0
                try:
                    raw_amt = float(amt)
                    amt_val = abs(raw_amt)
                except (TypeError, ValueError):
                    continue
                for divisor in (1, 100):
                    adj = amt_val / divisor
                    if abs(adj - expected_amt) / expected_amt < 0.10:
                        found_amount = True
                        matched_raw_amt = raw_amt / divisor
                        break
                if found_amount:
                    break

        if not found_amount:
            stripe_fail.append(
                f"{wt_supplier}: adjustment amount ~${expected_amt:.2f} "
                f"not found in invoices/prices")
            continue

        # ------------------------------------------------------------------
        # Direction check
        # ------------------------------------------------------------------
        if expected_dir:
            direction_ok = False
            direction_reason = ""

            if expected_dir == "charge":
                # A charge = positive invoice item / positive invoice total
                if matched_raw_amt is not None and matched_raw_amt > 0:
                    direction_ok = True
                else:
                    direction_reason = (
                        f"expected direction 'charge' (positive amount) but "
                        f"matched amount sign was "
                        f"{'negative' if matched_raw_amt is not None and matched_raw_amt < 0 else 'unknown'}"
                    )

            elif expected_dir == "credit":
                # A credit = negative invoice item OR a refund object referencing
                # this customer.
                # Note: credit_notes are _readonly in the mock (cannot be created
                # by the agent), so we accept negative line item OR refund only.
                if matched_raw_amt is not None and matched_raw_amt < 0:
                    direction_ok = True
                elif cust_id in refunds_by_cust:
                    # Verify at least one refund has an amount in range
                    for ref in refunds_by_cust[cust_id]:
                        ref_amt = abs(float(ref.get("amount") or 0))
                        for divisor in (1, 100):
                            if abs(ref_amt / divisor - expected_amt) / expected_amt < 0.10:
                                direction_ok = True
                                break
                        if direction_ok:
                            break
                if not direction_ok:
                    direction_reason = (
                        f"expected direction 'credit' (negative line item or refund) "
                        f"but matched amount was positive and no qualifying refund found"
                    )
            else:
                # Unknown direction: skip direction check
                direction_ok = True

            if not direction_ok:
                stripe_fail.append(
                    f"{wt_supplier}: {direction_reason}")

    # Non-adjustment suppliers must NOT have Stripe records
    for na_supplier in sorted(no_adj_suppliers):
        if na_supplier in cust_by_supplier:
            stripe_fail.append(
                f"{na_supplier}: should NOT have Stripe records "
                f"(root cause is not weight_typo)")

    checks.append(chk("stripe_adjustments_correct", not stripe_fail,
                       "ok" if not stripe_fail else "; ".join(stripe_fail[:5])))

    # ======================================================================
    # Check 8: causal_chain_accuracy — all 5 root causes correct
    # ======================================================================
    causal_fail: list[str] = []
    causal_correct = 0
    for spec in all_suppliers:
        s = spec["supplier"]
        expected_rc = spec["root_cause"]
        docs = supplier_docs.get(s, [])
        if not docs:
            causal_fail.append(f"{s}: no doc to check root cause")
            continue
        combined = " ".join(_dws_content_text(d) for d in docs)
        detected_rc = _detect_root_cause(combined)
        if detected_rc == expected_rc:
            causal_correct += 1
        else:
            causal_fail.append(
                f"{s}: expected {expected_rc}, detected {detected_rc or 'NONE'}")

    all_correct = causal_correct == len(all_suppliers)
    checks.append(chk("causal_chain_accuracy", all_correct,
                       f"{causal_correct}/{len(all_suppliers)} correct"
                       if all_correct else "; ".join(causal_fail[:5])))

    return checks


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    reward_json = Path(args.reward_json)
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    exp = json.loads(
        (task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))

    # Check source CSV integrity
    try:
        csv_dir = task_dir / exp.get("source_csv_dir", "workspace/customs_data")
        csv_files = list(csv_dir.glob("*.csv"))
        total_rows = 0
        for csv_path in csv_files:
            with csv_path.open(newline="", encoding="utf-8-sig") as f:
                total_rows += sum(1 for _ in csv.DictReader(f))
        source_min = int(exp.get("source_min_rows", 3800))
        source_ok = len(csv_files) >= 2 and total_rows >= source_min
        source_reason = (f"csv_files={len(csv_files)}, "
                         f"total_rows={total_rows}, min={source_min}")
    except Exception as exc:  # noqa: BLE001
        source_ok = False
        source_reason = f"source parse failed: {exc}"

    dws, dws_err = _read_state(("MOCK_SITE_URL_DWS_DOC_CLI",), token)
    stripe, stripe_err = _read_state(("MOCK_SITE_URL_STRIPE_CLI",), token, "/__bench/state")
    box, box_err = _read_state(("MOCK_SITE_URL_BOX_CLI",), token, "/__bench/state")

    checks = evaluate(exp, dws, stripe, box,
                       dws_err, stripe_err, box_err,
                       source_ok, source_reason)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dws_final_state.json").write_text(
        json.dumps(dws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "stripe_final_state.json").write_text(
        json.dumps(stripe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "box_final_state.json").write_text(
        json.dumps(box, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "validation_checks": checks,
        "passed": total > 0 and passed == total,
    }
    reward_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    print(json.dumps({
        "score": score,
        "checks_passed": passed,
        "checks_total": total,
        "passed": payload["passed"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
