"""v2 shared host-side verifier for alibaba_publish mock tasks.

Schema v2 design (per V2_TASK_DESIGN_GUIDE):
- Each expected field is one atomic deterministic_exact check
- Plus a handful of structural checks (session_exists, session_submitted,
  image uploads, mock_integrity)
- score = passed / total, no weights

The task supplies ``private/expected_answer.json`` with this shape::

    {
      "expected_fields": {"<field_name>": "<expected_value or json-string>", ...},
      "required_files": ["image_1", ...],          // optional, default ["image_1"]
      "image_selection": {                         // optional, advanced (multi-image tasks)
        "correct_files": ["main_product.jpg"],
        "acceptable_files": ["detail_angle.jpg"],
        "wrong_files": ["bad.jpg"]
      },
      "json_fields": ["selectedCountries", "deliveryPeriod"]  // optional, deep-compare list/dict fields
    }

Task ``files/verify_task.py`` is a thin wrapper that calls
``verify(task_dir, output_dir, reward_json_path, mock_url, mode)`` here.
"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from real_replica_bench.verifiers.form_value_normalize import compare_form_value


IMAGE_FIELDS = [f"image_{i}" for i in range(1, 7)] + ["video"]


# Field -> capability bucket (check-granularity R3/R4: collapse same-skill
# trivia into one capability unit, keep distinct skills separate). The mock's
# form vocabulary is shared across all alibaba_publish products, so one map
# covers the whole cluster (R7). New/unknown fields fall back by prefix
# (attr_* -> attributes, keyword_* -> title_keywords) else into other_fields,
# so a new product stays scorable before the map is extended.
FIELD_GROUPS: dict[str, str] = {
    # catalog placement / sale mode
    "category": "category_classification",
    "saleMode": "category_classification",
    "productGroup": "category_classification",
    # SEO title + keywords
    "productTitle": "title_keywords",
    "keyword_1": "title_keywords",
    "keyword_2": "title_keywords",
    "keyword_3": "title_keywords",
    # product attributes (read spec -> map to closed-set attributes)
    "attr_usage": "attributes",
    "attr_productType": "attributes",
    "attr_instructions": "attributes",
    "attr_brand": "attributes",
    "attr_model": "attributes",
    "attr_material": "attributes",
    "attr_diameter": "attributes",
    "attr_shape": "attributes",
    # pricing & trade terms
    "saleType": "pricing_terms",
    "priceUnit": "pricing_terms",
    "priceMode": "pricing_terms",
    "fobType": "pricing_terms",
    "fobPriceMin": "pricing_terms",
    "fobPriceMax": "pricing_terms",
    "minOrderQuantity": "pricing_terms",
    "inventory": "pricing_terms",
    "ladderPrice": "pricing_terms",
    "countryPriceDiff": "pricing_terms",
    # markets / logistics
    "selectedCountries": "logistics",
    "deliveryPeriod": "logistics",
    # publish flags
    "productVisible": "publish_settings",
    "descType": "publish_settings",
    "agreement": "publish_settings",
}

# Stable emission order for buckets that are present in a given product.
GROUP_ORDER = [
    "category_classification",
    "title_keywords",
    "attributes",
    "pricing_terms",
    "logistics",
    "publish_settings",
]


def group_for(field_name: str) -> str:
    g = FIELD_GROUPS.get(field_name)
    if g:
        return g
    if field_name.startswith("attr_"):
        return "attributes"
    if field_name.startswith("keyword_"):
        return "title_keywords"
    return "other_fields"


def _headers(verifier_token: str) -> dict[str, str]:
    h = {"Accept": "application/json"}
    if verifier_token:
        h["X-Mock-Verifier-Token"] = verifier_token
    return h


def _api_get(base: str, path: str, verifier_token: str = "") -> Any:
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, headers=_headers(verifier_token))
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _find_session_id(base: str, verifier_token: str) -> str | None:
    try:
        sessions = _api_get(base, "/api/sessions", verifier_token)
    except Exception:
        return None
    if isinstance(sessions, dict):
        sessions = sessions.get("sessions") or sessions.get("data") or []
    if not isinstance(sessions, list) or not sessions:
        return None
    # Prefer submitted sessions, else most recent
    submitted = [s for s in sessions if isinstance(s, dict) and s.get("status") == "submitted"]
    pool = submitted if submitted else sessions
    pool.sort(key=lambda s: s.get("updatedAt") or s.get("createdAt") or "", reverse=True)
    return pool[0].get("id") or pool[0].get("sessionId")


def _compare(field_name: str, actual: Any, expected: Any, is_json: bool = False) -> bool:
    """Compare a submitted mock-side value against the expected_answer.

    list-acceptable: if ``expected`` is a non-JSON list (i.e. plain Python list
    not is_json), treat it as alternatives — actual matches if it equals any
    element. Mirrors the pattern memorialised in CLAUDE.md memory
    "Alternative-property answers need list-acceptable verifier" (e.g.
    ``asia-supplier-tour-handoff``). Used by attribute fields where multiple
    defensible phrasings exist in source files (e.g. ``attr_material =
    ["SS304", "ASTM A351 CF8 (SS304)"]``).
    """
    if actual is None and expected is None:
        return True
    if is_json:
        return compare_form_value(field_name, actual, expected, as_json=True)
    # list-acceptable: any element matches → pass
    if isinstance(expected, list):
        return any(
            str(actual).strip() == str(alt).strip()
            for alt in expected
        )
    # String equality (mock stores values as strings)
    return str(actual).strip() == str(expected).strip()


def _deep_eq(a: Any, b: Any) -> bool:
    if type(a) != type(b):
        # Allow list ordering tolerance for lists of dicts
        if isinstance(a, list) and isinstance(b, list):
            pass
        else:
            return False
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        # order-tolerant: each item in a must appear in b
        for item in a:
            if not any(_deep_eq(item, other) for other in b):
                return False
        return True
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_deep_eq(a[k], b[k]) for k in a)
    return a == b


def _check(check_id: str, passed: bool, reason: str = "", check_type: str = "deterministic_exact") -> dict:
    return {"id": check_id, "passed": bool(passed), "reason": reason[:300], "check_type": check_type}


def _fold(check_id: str, atoms: list, check_type: str = "deterministic_exact") -> dict:
    """Fold atomic ``(name, passed, note)`` results into one capability check.

    ``passed = all atoms pass`` — pure aggregation, identical to the AND of the
    old per-item checks, so binary pass is unchanged and only capacity (passed
    / total) de-inflates. The internal per-field validation is untouched; every
    failing member is listed in ``reason`` so diagnosability is preserved.
    """
    total = len(atoms)
    failed = [a for a in atoms if not a[1]]
    npass = total - len(failed)
    if not failed:
        reason = f"{npass}/{total} ok"
    else:
        parts = []
        for a in failed:
            note = a[2] if len(a) > 2 and a[2] else ""
            parts.append(a[0] + (f"[{note}]" if note else ""))
        reason = f"{npass}/{total} ok; FAILED: " + "; ".join(parts)
    return _check(check_id, not failed, reason, check_type)


def verify(
    task_dir: Path,
    output_dir: Path,
    reward_json: Path,
    mock_url: str,
    mode: str = "browser",
) -> dict:
    task_dir = Path(task_dir)
    output_dir = Path(output_dir)
    reward_json = Path(reward_json)
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    expected_path = task_dir / "private" / "expected_answer.json"
    if not expected_path.exists():
        # legacy fallback to grading_truth.json for soft migration
        legacy = task_dir / "private" / "grading_truth.json"
        if legacy.exists():
            legacy_data = json.loads(legacy.read_text(encoding="utf-8-sig"))
            expected_data = {
                "expected_fields": legacy_data.get("expected", {}),
                "required_files": legacy_data.get("required_files", ["image_1"]),
                "image_selection": legacy_data.get("image_selection"),
                "json_fields": [],
            }
        else:
            return _emit(reward_json, task_dir.name, [_check("expected_answer_loaded", False, "expected_answer.json missing")])
    else:
        expected_data = json.loads(expected_path.read_text(encoding="utf-8-sig"))

    expected_fields: dict = expected_data.get("expected_fields") or {}
    required_files: list = expected_data.get("required_files") or ["image_1"]
    image_selection = expected_data.get("image_selection")
    json_field_names = set(expected_data.get("json_fields") or [])
    # auto-detect json fields by trying to parse expected values
    for k, v in expected_fields.items():
        if isinstance(v, str) and v.startswith(("[", "{")):
            try:
                json.loads(v)
                json_field_names.add(k)
            except Exception:
                pass

    fields: dict = {}
    status: str | None = None
    access_log: Any = []
    state_readable = False
    session_id = _find_session_id(mock_url, verifier_token)

    if session_id:
        try:
            state = _api_get(mock_url, f"/api/state/{session_id}", verifier_token)
            state_readable = True
            fields = state.get("fields") or {}
            status = state.get("status")
        except Exception:
            state_readable = False
        try:
            access_log = _api_get(mock_url, "/api/access-log", verifier_token)
            if not isinstance(access_log, list):
                access_log = []
        except Exception:
            access_log = []

    valid_event = "cli_submit_valid" if mode == "cli" else "ui_submit_valid"
    valid_submits = [
        e for e in access_log
        if e.get("event") == valid_event and e.get("sessionId") == session_id
    ] if session_id else []

    checks: list[dict] = []

    # setup_gate: plumbing folded (R2) — session reachable + readable + submitted
    # through a legitimate (browser-UI or Bearer-CLI) path. Precondition for any
    # field to be scorable; not a distinct capability of its own.
    setup_atoms = [
        ("session_exists", session_id is not None,
         "" if session_id else "no session on mock site"),
        ("session_state_readable", bool(session_id) and state_readable,
         "" if (session_id and state_readable) else "state not readable"),
        ("session_submitted", status == "submitted", f"status={status}"),
        ("mock_submit_via_legitimate_path", bool(valid_submits),
         f"need >=1 {valid_event} event, found {len(valid_submits)}"),
    ]
    checks.append(_fold("setup_gate", setup_atoms))

    # images_correct: collapse all image slots into one upload-skill check (R3)
    img_atoms: list = []
    if image_selection:
        correct = set(image_selection.get("correct_files") or [])
        acceptable = set(image_selection.get("acceptable_files") or [])
        wrong = set(image_selection.get("wrong_files") or [])
        for slot in required_files:
            v = (fields.get(slot) or {}).get("value", "")
            base = v.split("/")[-1] if v else ""
            ok = bool(base) and (base in correct or base in acceptable) and base not in wrong
            img_atoms.append((slot, ok, f"value={base!r}"))
    else:
        for slot in required_files:
            f = fields.get(slot, {})
            uploaded = bool(f.get("value") or f.get("filePath"))
            img_atoms.append((slot, uploaded, f"value={(f.get('value') or '')[:60]!r}"))
    if img_atoms:
        checks.append(_fold("images_correct", img_atoms))

    # Field accuracy folded into capability buckets (R3 same-skill / R4 distinct
    # skills). Each bucket = AND of its present member fields; failing members
    # are listed in reason. Only buckets with >=1 present field are emitted.
    bucket_atoms: dict[str, list] = {}
    for field_name, expected_val in expected_fields.items():
        actual = (fields.get(field_name) or {}).get("value", "")
        is_json = field_name in json_field_names
        ok = _compare(field_name, actual, expected_val, is_json=is_json)
        snippet = (str(actual)[:60] + ("..." if len(str(actual)) > 60 else "")) if actual != "" else "(empty)"
        bucket_atoms.setdefault(group_for(field_name), []).append((field_name, ok, f"got={snippet}"))
    extras = sorted(b for b in bucket_atoms if b not in GROUP_ORDER)
    for bucket in GROUP_ORDER + extras:
        atoms = bucket_atoms.get(bucket)
        if atoms:
            checks.append(_fold(f"{bucket}_correct", atoms))

    # Persist final state for debugging
    if output_dir.is_dir():
        try:
            (output_dir / "mock_alibaba_publish_final_state.json").write_text(
                json.dumps({"session_id": session_id, "fields": fields}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass

    return _emit(reward_json, task_dir.name, checks)


def _emit(reward_json: Path, task_id: str, checks: list[dict]) -> dict:
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    payload = {
        "schema_version": "2.0",
        "task_id": task_id,
        "score": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "reward": score,
        "passed": passed == total,
        "source": "v2_alibaba_publish",
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "checks_passed", "checks_total")}))
    return payload
