"""v2 verifier for file-commerce-ops-lc-eco-tote-discrepancy-audit.

Matches the agent's outputs/discrepancy_audit.json against
private/expected_answer.json. The validation/computation logic is unchanged
from the original atomic verifier; only the EMIT layer is folded per the
capacity-check granularity guide (docs/check-granularity.md):

  - setup_gate (R2)              <- file exists/parseable + schema valid
  - material_found::M1..M8 (R3a) <- per discrepancy: found AND rule_cite correct
  - trap_classified::T1..T6 (R3a)<- per trap: present in non_material, absent
                                     from material, AND rule_cite correct
  - no_false_positives (R6)      <- exactly 8 material entries (restraint/count)
  - decision_correct (R6)        <- decision_enum == 'discrepant'

A "discrepancy audit" measures completeness: finding every material
discrepancy and correctly clearing every trap are the two hard graded
competencies, so each item stays its own check (R3a). rule_cite is a
sub-condition of the SAME competency unit (spot discrepancy N + cite the
governing rule) and is folded into that item's check, not a separate one.
Per-item failure detail is preserved in the `reason` strings.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


# ---------- normalization helpers ----------

_PUNCT_RE = re.compile(r"[\s\-_./()]+")


def norm(s: Any) -> str:
    if s is None:
        return ""
    return _PUNCT_RE.sub("", str(s).strip().lower())


_DOC_ALIASES: dict[str, str] = {
    "ci": "commercialinvoice",
    "invoice": "commercialinvoice",
    "pl": "packinglist",
    "bl": "billoflading",
    "billoflading": "billoflading",
    "co": "certificateoforigin",
    "coorigin": "certificateoforigin",
    "ip": "insurancepolicy",
    "insurance": "insurancepolicy",
    "coverletter": "bankpresentationschedule",
    "presentation": "bankpresentationschedule",
    "schedule": "bankpresentationschedule",
}


def norm_doc(s: Any) -> str:
    s_norm: str = norm(s)
    mapped = _DOC_ALIASES.get(s_norm)
    return mapped if mapped is not None else s_norm


def norm_field(s: Any) -> str:
    return norm(s)


# ---------- discrepancy matching ----------

def find_entry(
    array: list[dict[str, Any]],
    doc_enums: list[str],
    field_aliases: list[str],
) -> dict[str, Any] | None:
    """Find first entry whose doc matches one of doc_enums and field matches an alias."""
    doc_set = {norm_doc(d) for d in doc_enums}
    field_set = {norm_field(f) for f in field_aliases}
    for entry in array:
        if not isinstance(entry, dict):
            continue
        e_doc = norm_doc(entry.get("doc"))
        e_field = norm_field(entry.get("field"))
        if e_doc in doc_set and e_field in field_set:
            return entry
    return None


def rule_cite_matches(entry: dict[str, Any], must_contain_any_of: list[str]) -> bool:
    cite = str(entry.get("rule_cite", "")).lower()
    return any(tok.lower() in cite for tok in must_contain_any_of)


# ---------- per-item evaluation (validation logic UNCHANGED) ----------

def check_answer_exists(audit_path: Path) -> tuple[bool, str, dict | None]:
    if not audit_path.exists():
        return False, "discrepancy_audit.json missing", None
    if audit_path.stat().st_size == 0:
        return False, "discrepancy_audit.json empty", None
    try:
        data = json.loads(audit_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        return False, f"json parse error: {exc}", None
    if not isinstance(data, dict):
        return False, "top-level is not an object", None
    return True, "ok", data


def check_schema_valid(data: dict | None) -> tuple[bool, str]:
    if data is None:
        return False, "data missing"
    required = ("material_discrepancies", "non_material_examined", "decision_enum")
    missing = [k for k in required if k not in data]
    if missing:
        return False, f"missing keys: {missing}"
    if not isinstance(data.get("material_discrepancies"), list):
        return False, "material_discrepancies is not an array"
    if not isinstance(data.get("non_material_examined"), list):
        return False, "non_material_examined is not an array"
    if not isinstance(data.get("decision_enum"), str):
        return False, "decision_enum is not a string"
    return True, "ok"


def eval_material_item(
    exp: dict[str, Any],
    material_arr: list[dict[str, Any]],
) -> tuple[bool, str]:
    """One material discrepancy = found in material_discrepancies AND rule cited.

    found and rule_cite are sub-conditions of the same competency unit (spot
    this discrepancy and cite the governing rule); the per-item check passes
    only when both hold.
    """
    doc_enums = [exp["doc_enum"]] if "doc_enum" in exp else exp.get("doc_enum_any_of", [])
    field_aliases = exp.get("field_aliases", [])
    entry = find_entry(material_arr, doc_enums, field_aliases)
    if entry is None:
        return False, f"not flagged: no material entry for doc in {doc_enums} + field aliases"
    if not rule_cite_matches(entry, exp["rule_cite_must_contain_any_of"]):
        return (
            False,
            f"flagged (doc={entry.get('doc')} field={entry.get('field')}) but rule_cite="
            f"{entry.get('rule_cite')!r} missing one of {exp['rule_cite_must_contain_any_of'][:4]}...",
        )
    return True, f"ok doc={entry.get('doc')} field={entry.get('field')} rule_cite={entry.get('rule_cite')!r}"


def eval_trap_item(
    exp: dict[str, Any],
    non_material_arr: list[dict[str, Any]],
    material_arr: list[dict[str, Any]],
) -> tuple[bool, str]:
    """One trap = present in non_material AND absent from material AND rule cited."""
    doc_enums = [exp["doc_enum"]] if "doc_enum" in exp else exp.get("doc_enum_any_of", [])
    field_aliases = exp.get("field_aliases", [])
    nm_entry = find_entry(non_material_arr, doc_enums, field_aliases)
    m_entry = find_entry(material_arr, doc_enums, field_aliases)
    if nm_entry is None:
        return False, f"trap not classified non-material for doc in {doc_enums}"
    if m_entry is not None:
        return (
            False,
            f"trap (doc={nm_entry.get('doc')} field={nm_entry.get('field')}) ALSO listed as "
            f"material — false positive",
        )
    if not rule_cite_matches(nm_entry, exp["rule_cite_must_contain_any_of"]):
        return (
            False,
            f"non-material (doc={nm_entry.get('doc')} field={nm_entry.get('field')}) but rule_cite="
            f"{nm_entry.get('rule_cite')!r} missing one of {exp['rule_cite_must_contain_any_of'][:4]}...",
        )
    return True, f"ok doc={nm_entry.get('doc')} field={nm_entry.get('field')} rule_cite={nm_entry.get('rule_cite')!r}"


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir).resolve()
    reward_path = Path(args.reward_json)
    reward_path.parent.mkdir(parents=True, exist_ok=True)

    output_dir = Path(args.output_dir) if args.output_dir else task_dir / "outputs"
    audit_path = output_dir / "discrepancy_audit.json"

    expected = json.loads((task_dir / "private" / "expected_answer.json").read_text(encoding="utf-8-sig"))
    rubric = json.loads((task_dir / "rubric.json").read_text(encoding="utf-8-sig"))
    checks_spec = rubric.get("checks", [])

    # Load agent's answer
    exists_ok, exists_reason, data = check_answer_exists(audit_path)
    schema_ok, schema_reason = check_schema_valid(data)

    material_arr = data.get("material_discrepancies", []) if isinstance(data, dict) else []
    non_material_arr = data.get("non_material_examined", []) if isinstance(data, dict) else []
    decision_enum = data.get("decision_enum", "") if isinstance(data, dict) else ""
    if not isinstance(material_arr, list):
        material_arr = []
    if not isinstance(non_material_arr, list):
        non_material_arr = []

    # ----- folded check results -----
    runtime_results: dict[str, tuple[bool, str]] = {}

    # setup_gate (R2): file exists/parseable + schema valid
    setup_ok = exists_ok and schema_ok
    if exists_ok and schema_ok:
        setup_reason = "ok: deliverable present, parseable, schema valid"
    elif not exists_ok:
        setup_reason = f"file: {exists_reason}"
    else:
        setup_reason = f"schema: {schema_reason}"
    runtime_results["setup_gate"] = (setup_ok, setup_reason)

    # material_found::M1..M8 (R3a): one per discrepancy, found AND rule cited
    for exp in expected["material_discrepancies"]:
        cid = f"material_found::{exp['expected_id']}"
        runtime_results[cid] = eval_material_item(exp, material_arr)

    # trap_classified::T1..T6 (R3a): one per trap
    for exp in expected["non_material_examined"]:
        cid = f"trap_classified::{exp['expected_id']}"
        runtime_results[cid] = eval_trap_item(exp, non_material_arr, material_arr)

    # no_false_positives (R6): exactly 8 material entries, no spurious additions
    runtime_results["no_false_positives"] = (
        len(material_arr) == 8,
        f"material_discrepancies has {len(material_arr)} entries (expected exactly 8)",
    )

    # decision_correct (R6): honour/refuse conclusion
    runtime_results["decision_correct"] = (
        norm(decision_enum) == "discrepant",
        f"decision_enum={decision_enum!r} (expected 'discrepant')",
    )

    # ----- emit per-rubric check -----
    breakdown = []
    passed = 0
    for c in checks_spec:
        cid = c["id"]
        ok, reason = runtime_results.get(cid, (False, f"no runtime result for check id {cid!r}"))
        breakdown.append({
            "id": cid,
            "passed": ok,
            "reason": reason,
            "check_type": c.get("check_type", "deterministic_exact"),
        })
        if ok:
            passed += 1

    total = len(checks_spec)
    score = passed / total if total > 0 else 0.0

    reward = {
        "schema_version": "2.0",
        "task_id": rubric.get("task_id"),
        "score": round(score, 4),
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": breakdown,
        "reward": round(score, 4),
        "passed": passed == total,
        "source": "v2_checks_runner",
    }
    reward_path.write_text(json.dumps(reward, ensure_ascii=False, indent=2))
    print(json.dumps({k: reward[k] for k in ("score", "checks_passed", "checks_total")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
