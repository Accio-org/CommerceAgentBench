#!/usr/bin/env python3
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


def norm(s):
    return " ".join(str(s or "").strip().casefold().split())


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def build_checks(state, expected, state_err=""):
    files = [f for f in state.get("files", []) if not f.get("trashed_at") and not f.get("is_deleted")]
    comments = [c for c in state.get("comments", []) if not c.get("is_deleted")]
    tasks = [t for t in state.get("tasks", []) if not t.get("is_deleted") and not t.get("is_completed")]
    links = [l for l in state.get("shared_links", []) if not l.get("is_deleted")]
    collabs = [c for c in state.get("collaborations", []) if not c.get("is_deleted")]
    users = state.get("users", [])

    by_file = {str(f.get("id")): f for f in files}
    comments_by_file = {}
    for c in comments:
        comments_by_file.setdefault(str(c.get("item_id")), []).append(c)
    tasks_by_file = {}
    for t in tasks:
        tasks_by_file.setdefault(str(t.get("file_id")), []).append(t)

    reviewer = next(
        (str(u.get("id")) for u in users if norm(u.get("login")) == norm(expected["legal_reviewer_login"])),
        "",
    )

    checks = [
        chk("mock_reachable", isinstance(state, dict) and bool(files) and not state_err, state_err or "box state reachable")
    ]
    sfx = f" ({state_err})" if state_err else ""

    expected_file_ids = set(expected["all_file_ids"])
    actual_file_ids = {str(f.get("id")) for f in files}
    checks.append(chk(
        "exact_active_file_set",
        actual_file_ids == expected_file_ids,
        f"expected original active files only; extra={sorted(actual_file_ids - expected_file_ids)} missing={sorted(expected_file_ids - actual_file_ids)}{sfx}",
    ))

    for file_id, parent_id in expected["expected_parents"].items():
        got = str((by_file.get(file_id) or {}).get("parent_id"))
        checks.append(chk(f"parent::{file_id}", got == str(parent_id),
                          f"expected parent {parent_id}, got {got or '(missing)'}{sfx}"))

    for file_id, sku in expected["ready_files"].items():
        msgs = [str(c.get("message") or "") for c in comments_by_file.get(file_id, [])]
        ok = len(msgs) == 1 and "APPROVED FOR LAUNCH" in msgs[0].upper() and sku in msgs[0]
        checks.append(chk(f"ready_comment::{file_id}", ok, f"expected one launch comment for {sku}, got {msgs}{sfx}"))
        checks.append(chk(f"ready_no_task::{file_id}", len(tasks_by_file.get(file_id, [])) == 0,
                          f"ready file must not have open tasks{sfx}"))

    for file_id, info in expected["legal_files"].items():
        sku = info["sku"]
        want_codes = {str(c).upper() for c in info["codes"]}
        file_tasks = tasks_by_file.get(file_id, [])
        messages = [str(t.get("message") or "") for t in file_tasks]
        blob = "\n".join(messages).upper()
        codes_ok = len(file_tasks) == 1 and all(code in blob for code in want_codes) and sku in blob
        due_ok = len(file_tasks) == 1 and str(file_tasks[0].get("due_at") or "") == expected["task_due_at"]
        checks.append(chk(f"legal_task_codes::{file_id}", codes_ok,
                          f"expected one task with {sorted(want_codes)} and {sku}, got {messages}{sfx}"))
        checks.append(chk(f"legal_task_due::{file_id}", due_ok,
                          f"expected due_at {expected['task_due_at']}{sfx}"))
        checks.append(chk(f"legal_no_comment::{file_id}", len(comments_by_file.get(file_id, [])) == 0,
                          f"legal-review file must not have launch comment{sfx}"))

    for file_id in expected["archive_files"] + expected["reference_files"]:
        checks.append(chk(f"quiet_file::{file_id}",
                          len(comments_by_file.get(file_id, [])) == 0 and len(tasks_by_file.get(file_id, [])) == 0,
                          f"archive/reference file must not have comments or open tasks{sfx}"))

    expected_launch_folder_ids = set(expected["launch_folders"].values())
    for sku, folder_id in expected["launch_folders"].items():
        folder_links = [l for l in links if l.get("item_type") == "folder" and str(l.get("item_id")) == str(folder_id)]
        ok = len(folder_links) == 1 and folder_links[0].get("access") == "company"
        checks.append(chk(f"launch_shared_link::{sku}", ok,
                          f"expected one company shared link on launch folder {folder_id}, found {folder_links}{sfx}"))

    expected_review_folder_ids = set(expected["review_folders"].values())
    for sku, folder_id in expected["review_folders"].items():
        folder_collabs = [
            c for c in collabs
            if c.get("item_type") == "folder"
            and str(c.get("item_id")) == str(folder_id)
            and str(c.get("accessible_by")) == reviewer
            and c.get("role") == "viewer"
        ]
        checks.append(chk(f"reviewer_collab::{sku}", len(folder_collabs) == 1,
                          f"expected one viewer collab for reviewer on {folder_id}, found {folder_collabs}{sfx}"))

    all_folder_links = [l for l in links if l.get("item_type") == "folder"]
    checks.append(chk(
        "exact_folder_shared_link_set",
        {str(l.get("item_id")) for l in all_folder_links} == expected_launch_folder_ids and len(all_folder_links) == len(expected_launch_folder_ids),
        f"expected shared links only on launch folders {sorted(expected_launch_folder_ids)}, got {[l.get('item_id') for l in all_folder_links]}{sfx}",
    ))

    all_reviewer_collabs = [
        c for c in collabs
        if c.get("item_type") == "folder" and str(c.get("accessible_by")) == reviewer and c.get("role") == "viewer"
    ]
    checks.append(chk(
        "exact_reviewer_collab_set",
        {str(c.get("item_id")) for c in all_reviewer_collabs} == expected_review_folder_ids and len(all_reviewer_collabs) == len(expected_review_folder_ids),
        f"expected reviewer collabs only on review folders {sorted(expected_review_folder_ids)}, got {[c.get('item_id') for c in all_reviewer_collabs]}{sfx}",
    ))

    checks.append(chk(
        "exact_open_task_count",
        len(tasks) == len(expected["legal_files"]),
        f"expected exactly {len(expected['legal_files'])} open tasks, got {len(tasks)}{sfx}",
    ))
    checks.append(chk(
        "exact_comment_count",
        len(comments) == len(expected["ready_files"]),
        f"expected exactly {len(expected['ready_files'])} comments, got {len(comments)}{sfx}",
    ))
    return checks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--reward-json", required=True)
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    output_dir = Path(args.output_dir)
    expected = json.loads((task_dir / "private/expected_answer.json").read_text())
    mock_url = os.environ.get("MOCK_SITE_URL", "").rstrip("/")
    token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    state, state_err = {}, ""
    if not mock_url:
        state_err = "MOCK_SITE_URL not set"
    else:
        try:
            state = fetch_state(f"{mock_url}/__bench/state", token)
        except Exception as exc:  # noqa: BLE001
            state_err = f"state fetch failed: {exc}"

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "box_final_state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")

    checks = build_checks(state, expected, state_err)
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    score = round(passed / total, 4) if total else 0.0
    result = {
        "schema_version": "2.0",
        "task_id": task_dir.name,
        "score": score,
        "reward": score,
        "checks_passed": passed,
        "checks_total": total,
        "checks_breakdown": checks,
        "passed": passed == total,
    }
    Path(args.reward_json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"score": score, "checks_passed": passed, "checks_total": total, "passed": result["passed"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
