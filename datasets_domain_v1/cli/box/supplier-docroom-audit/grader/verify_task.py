#!/usr/bin/env python3
"""Deterministic verifier for cli-box-supplier-docroom-audit.

Reads the FINAL box_cli state over the bench HTTP bridge
(GET ${MOCK_SITE_URL}/__bench/state, header X-Mock-Verifier-Token:
${MOCK_VERIFIER_TOKEN}) and scores it against private/expected_answer.json
(ground truth). Emits a v2 reward.

The Box state the agent produces IS the deliverable: each supplier's
compliant/non-compliant verdict is encoded in the actions taken on its folder —
a shared link (compliant) vs. a task + a viewer collaboration (non-compliant) —
plus the mis-shelved documents moved to the folder they belong to and the
corporate group cert left in place. There is no separate summary artifact, so the
score is discriminated by the final Box state, including whether the agent used
the stateful CLI operations precisely rather than spraying duplicate tasks,
collaborations, links, or copied files.

`evaluate(expected, state, ...)` is the single source of truth for the atomic
checks; main() supplies the live Box state, and the scratch gold/naive solvers
feed it simulated states to validate fairness offline.
"""
import argparse
import json
import os
import urllib.request
from collections import defaultdict
from pathlib import Path


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300],
            "check_type": "deterministic_exact"}


def norm_name(s):
    return " ".join(str(s or "").strip().lower().split())


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _group(cid, members, reason_ok="ok"):
    """Fold a list of per-item atom dicts into one capability check.

    new check passes iff ALL member atoms pass (pure aggregation). The per-item
    detail of the failing members is preserved in `reason` for diagnosis, exactly
    as the check-granularity guide (R3/R6) prescribes — `checks_total` reflects
    distinct capability units, not template-times-N repetition.
    """
    fails = [m for m in members if not m["passed"]]
    ok = not fails and bool(members)
    if ok:
        reason = reason_ok
    elif not members:
        reason = "no items to check"
    else:
        # Surface up to a handful of the per-item failure reasons.
        detail = "; ".join(f"[{m['id']}] {m['reason']}" for m in fails[:4])
        reason = f"{len(fails)}/{len(members)} failed: {detail}"
    return {"id": cid, "passed": ok, "reason": str(reason)[:300],
            "check_type": "deterministic_exact"}


def evaluate(expected, state, state_err=""):
    """Build the capability-check list from ground truth + the final Box state.

    state — dict shaped like `box-bench state` (users/folders/files/
            collaborations/shared_links/tasks); {} if unreadable.

    The Box state IS the deliverable. Internally we still validate every supplier
    folder / mis-shelved document atomically (so the `reason` strings name the
    exact folder or file that broke); the checks we EMIT are aggregated into
    distinct capability units per docs/check-granularity.md (R1–R7). The binary
    pass (all checks) is identical to the per-atom schema — the AND of grouped
    atoms equals the AND of the atoms — but `checks_total` no longer explodes
    one template across the 16/15/3 inputs.
    """
    fid_to_name = {s["folder_id"]: s["folder_name"] for s in expected["suppliers"]}

    users = state.get("users", []) if isinstance(state, dict) else []
    folders = state.get("folders", []) if isinstance(state, dict) else []
    # Treat trashed files/links as absent.
    files = [f for f in state.get("files", []) if not f.get("trashed_at")] if isinstance(state, dict) else []
    collabs = [c for c in state.get("collaborations", [])
               if not c.get("is_deleted")] if isinstance(state, dict) else []
    links = [l for l in state.get("shared_links", [])
             if not l.get("is_deleted") and not l.get("unshared_at")] if isinstance(state, dict) else []
    tasks = [t for t in state.get("tasks", [])
             if not t.get("is_deleted") and not t.get("is_completed")] if isinstance(state, dict) else []

    qa_login = expected["qa_reviewer_login"]
    qa_id = next((str(u["id"]) for u in users
                  if norm_name(u.get("login")) == norm_name(qa_login)),
                 str(expected.get("qa_reviewer_user_id", "")))

    files_by_parent = defaultdict(list)
    for f in files:
        files_by_parent[str(f.get("parent_id"))].append(f)

    def file_ids_in(fid):
        return {str(f.get("id")) for f in files_by_parent.get(str(fid), [])}

    def tasks_in(fid):
        ids = file_ids_in(fid)
        return [t for t in tasks if str(t.get("file_id")) in ids]

    def has_exactly_one_task_in(fid):
        return len(tasks_in(fid)) == 1

    def viewer_collabs_on(fid):
        return [c for c in collabs
                if c.get("item_type") == "folder" and str(c.get("item_id")) == str(fid)
                and c.get("role") == "viewer" and str(c.get("accessible_by")) == qa_id]

    def collabs_on(fid):
        return [c for c in collabs
                if c.get("item_type") == "folder" and str(c.get("item_id")) == str(fid)]

    def shared_links_on(fid):
        return [l for l in links
                if l.get("item_type") == "folder" and str(l.get("item_id")) == str(fid)]

    sfx = f" ({state_err})" if state_err else ""

    # --- Internal per-item atoms (every folder / document is still validated
    #     atomically; these feed the grouped capability checks below and supply
    #     the diagnostic `reason` strings). Predicates are unchanged from the
    #     pre-migration per-atom schema. ---
    all_policy_codes = {
        str(code).upper()
        for codes in expected.get("deficiency_codes_by_folder", {}).values()
        for code in codes
    }

    task_atoms = []          # one open task on a doc in each non-compliant folder
    code_atoms = []          # exact deficiency-code set on each non-compliant task
    due_atoms = []           # required due_at on each non-compliant task
    nc_collab_atoms = []     # exactly one QA viewer collab on each non-compliant folder
    nc_no_link_atoms = []    # non-compliant folder has NO shared link (negative)
    link_atoms = []          # one shared link on each compliant folder
    c_no_task_atoms = []     # compliant folder has NO task (negative)
    c_no_collab_atoms = []   # compliant folder has NO collaboration (negative)

    # 1. Non-compliant suppliers: a task on a doc in the folder + a viewer collab
    #    for the QA user on the folder + NO shared link + exact deficiency codes.
    for fid in expected["noncompliant_folders"]:
        nm = fid_to_name.get(fid, fid)
        task_atoms.append(chk(f"task::{nm}", has_exactly_one_task_in(fid),
                              f"expected exactly one open task on a document in '{nm}', "
                              f"found {len(tasks_in(fid))}{sfx}"))
        want_codes = expected.get("deficiency_codes_by_folder", {}).get(str(fid), [])
        if want_codes:
            folder_tasks = tasks_in(fid)
            messages = [str(t.get("message") or "") for t in folder_tasks]
            msg_blob = "\n".join(messages).upper()
            due_at = expected.get("task_due_at")
            found_codes = {code for code in all_policy_codes if code in msg_blob}
            want_code_set = {str(code).upper() for code in want_codes}
            codes_ok = found_codes == want_code_set
            code_atoms.append(chk(f"task_codes::{nm}", codes_ok,
                                  f"expected exact task codes {sorted(want_code_set)} in '{nm}', "
                                  f"found {sorted(found_codes)}; messages={messages[:3]}{sfx}"))
            if due_at:
                due_ok = len(folder_tasks) == 1 and str(folder_tasks[0].get("due_at") or "") == str(due_at)
                due_atoms.append(chk(f"task_due::{nm}", due_ok,
                                     f"expected exactly one task due_at={due_at} in '{nm}'{sfx}"))
        nc_collab_atoms.append(chk(f"collab_viewer::{nm}", len(viewer_collabs_on(fid)) == 1,
                                   f"expected exactly one role=viewer collaboration for {qa_login} "
                                   f"on '{nm}', found {len(viewer_collabs_on(fid))}{sfx}"))
        nc_no_link_atoms.append(chk(f"no_shared_link::{nm}", len(shared_links_on(fid)) == 0,
                                    f"non-compliant '{nm}' must NOT have a shared link{sfx}"))

    # 2. Compliant suppliers: a shared link on the folder + NO task + NO collab.
    for fid in expected["compliant_folders"]:
        nm = fid_to_name.get(fid, fid)
        link_atoms.append(chk(f"shared_link::{nm}", len(shared_links_on(fid)) == 1,
                              f"expected exactly one shared link on compliant '{nm}', "
                              f"found {len(shared_links_on(fid))}{sfx}"))
        c_no_task_atoms.append(chk(f"no_task::{nm}", len(tasks_in(fid)) == 0,
                                   f"compliant '{nm}' must NOT have a task{sfx}"))
        c_no_collab_atoms.append(chk(f"no_collab::{nm}", len(collabs_on(fid)) == 0,
                                     f"compliant '{nm}' must NOT have a collaboration{sfx}"))

    # 3. Mis-shelved docs reconciled: each now lives in the folder of the supplier
    #    its name references and no longer in the folder it was shelved into.
    filing_atoms = []
    for mf in expected["misfiled_files"]:
        matching = [f for f in files if f.get("name") == mf["name"]]
        in_to = any(str(f.get("parent_id")) == str(mf["to_folder_id"]) for f in matching)
        in_from = any(str(f.get("parent_id")) == str(mf["from_folder_id"]) for f in matching)
        to_nm = fid_to_name.get(str(mf["to_folder_id"]), mf["to_folder_id"])
        filing_atoms.append(chk(f"misfiled_moved::{mf['name']}", in_to and not in_from,
                                f"'{mf['name']}' must be moved to '{to_nm}' (folder {mf['to_folder_id']}) "
                                f"and removed from {mf['from_folder_id']} (in_to={in_to}, in_from={in_from}){sfx}"))

    # 3b. No-supplier-token certs (a corporate group cert) belong to no supplier
    #     folder: they must stay put. An over-eager agent that "reconciles" them
    #     is penalised here. Same filing competence -> folded with the moves.
    for bf in expected.get("blanket_files", []):
        matching = [f for f in files if f.get("name") == bf["name"]]
        stayed = bool(matching) and all(str(f.get("parent_id")) == str(bf["home_folder_id"]) for f in matching)
        home_nm = fid_to_name.get(str(bf["home_folder_id"]), bf["home_folder_id"])
        filing_atoms.append(chk(f"blanket_not_moved::{bf['name']}", stayed,
                                f"group cert '{bf['name']}' must be LEFT in '{home_nm}' "
                                f"(folder {bf['home_folder_id']}); it belongs to no supplier folder{sfx}"))

    # 4. No non-viewer collaboration on any supplier folder.
    supplier_ids = {str(x) for x in expected["supplier_folder_ids"]}
    bad_roles = [f"{c.get('item_id')}:{c.get('role')}" for c in collabs
                 if c.get("item_type") == "folder" and str(c.get("item_id")) in supplier_ids
                 and c.get("role") != "viewer"]
    nonviewer_atom = chk("no_nonviewer_collab", len(bad_roles) == 0,
                         f"only role=viewer collaborations allowed on supplier folders; found {bad_roles}{sfx}")

    # 5. Exact aggregate counts (anti-duplication guards).
    supplier_file_ids = {str(f.get("id")) for fid in supplier_ids for f in files_by_parent.get(str(fid), [])}
    supplier_tasks = [t for t in tasks if str(t.get("file_id")) in supplier_file_ids]
    supplier_viewer_collabs = [c for c in collabs
                               if c.get("item_type") == "folder"
                               and str(c.get("item_id")) in supplier_ids
                               and c.get("role") == "viewer"
                               and str(c.get("accessible_by")) == qa_id]
    supplier_links = [l for l in links
                      if l.get("item_type") == "folder"
                      and str(l.get("item_id")) in supplier_ids]
    count_atoms = [
        chk("exact_supplier_task_count",
            len(supplier_tasks) == len(expected["noncompliant_folders"]),
            f"expected exactly {len(expected['noncompliant_folders'])} open supplier tasks, "
            f"found {len(supplier_tasks)}{sfx}"),
        chk("exact_supplier_viewer_collab_count",
            len(supplier_viewer_collabs) == len(expected["noncompliant_folders"]),
            f"expected exactly {len(expected['noncompliant_folders'])} QA viewer collabs, "
            f"found {len(supplier_viewer_collabs)}{sfx}"),
        chk("exact_supplier_shared_link_count",
            len(supplier_links) == len(expected["compliant_folders"]),
            f"expected exactly {len(expected['compliant_folders'])} supplier shared links, "
            f"found {len(supplier_links)}{sfx}"),
    ]

    # --- Emit one check per distinct capability unit (R1–R7). Each group is the
    #     AND of its member atoms, so `all(checks) == all(atoms)` exactly and the
    #     binary pass is unchanged from the pre-migration schema. ---
    checks = []

    # R2: all environment plumbing folds into one setup gate. Fail loud if the
    # mock state could not be read; the capability checks still run so the
    # breakdown shows which competencies went unexercised.
    checks.append(chk("setup_gate",
                      isinstance(state, dict) and bool(state) and not state_err,
                      state_err or "box bench state read over MOCK_SITE_URL"))

    # Filing the room (R3 moves + R6 leave-the-group-cert) — one competence:
    # decide from filename/body evidence what is genuinely mis-shelved.
    checks.append(_group("documents_filed_correctly", filing_atoms,
                         "3 mis-shelved docs moved to their owner; group cert left in place"))

    # Non-compliant workflow, four distinct capabilities (R4): classify+act,
    # derive the right reason, set the deadline, grant QA access.
    checks.append(_group("noncompliant_tasks_created", task_atoms,
                         "exactly one open task on a document in every non-compliant folder"))
    # Verdict-reasoning core (§4 scope/entity/currency judgement): the exact
    # deficiency-code set per folder, incl. the double-code expired+sister edge.
    checks.append(_group("deficiency_codes_correct", code_atoms,
                         "every non-compliant task carries the exact required deficiency codes"))
    checks.append(_group("task_due_dates_correct", due_atoms,
                         "every non-compliant task has the required due date"))
    checks.append(_group("qa_viewer_collabs_created", nc_collab_atoms,
                         "exactly one QA viewer collaboration on every non-compliant folder"))

    # Compliant workflow: grant a shared link (R3).
    checks.append(_group("compliant_shared_links_created", link_atoms,
                         "exactly one shared link on every compliant folder"))

    # Restraint / negative competences (R6): each tests that the agent withheld
    # the wrong action for the verdict it reached.
    checks.append(_group("noncompliant_no_shared_link", nc_no_link_atoms,
                         "no non-compliant folder has a shared link"))
    checks.append(_group("compliant_no_task_no_collab",
                         c_no_task_atoms + c_no_collab_atoms,
                         "no compliant folder has a task or collaboration"))
    checks.append(nonviewer_atom)

    # Anti-duplication: exact action cardinality across the whole room (R6).
    checks.append(_group("exact_action_counts", count_atoms,
                         "exactly 16 tasks, 16 QA viewer collabs, 15 shared links"))

    return checks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    a = ap.parse_args()
    task = Path(a.task_dir)
    out_dir = Path(a.output_dir)

    expected = json.loads((task / "private/expected_answer.json").read_text())

    mock_url = os.environ.get("MOCK_SITE_URL", "").rstrip("/")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    state, state_err = {}, ""
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
    else:
        try:
            state = fetch_state(f"{mock_url}/__bench/state", token)
        except Exception as e:  # noqa: BLE001
            state_err = f"state fetch failed: {e}"

    # Persist the final state for debugging (best-effort).
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "mock_box_final_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass

    checks = evaluate(expected, state, state_err=state_err)

    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    reward = round(passed / total, 4) if total else 0.0
    result = {
        "schema_version": "2.0",
        "task_id": task.name,
        "score": reward,
        "reward": reward,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "passed": passed == total,
    }
    Path(a.reward_json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"score": reward, "checks_passed": passed, "checks_total": total,
                      "passed": result["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
