#!/usr/bin/env python3
"""Deterministic verifier for cli-todoist-sourcing-schedule (CAPABILITY-COVERAGE edition).

The agent triages a sourcing/procurement backlog in the todoist_cli mock, and the
GRADED STATE is the final Todoist project state — there is no schedule, no dedup,
no agent-written file. For every backlog card the agent decides
whether the candidate vendor's stated capability COVERS the item's manufacturing
requirement and routes it:

  COVERED      -> section `Ready to PO`     (and NO `capability-gap` label)
  NOT COVERED  -> section `Re-source`       (and the expected gap-reason labels)

Each card therefore carries TWO atomic checks, both driven by the one coverage
judgement:

  * section::<title>   — the card is ACTIVE and in the expected section.
  * labels::<title>    — the card is ACTIVE and carries exactly the expected label
                         set (no labels for covered cards; capability-gap plus
                         reason labels for not-covered cards).

A mis-judged coverage call flips BOTH the section and the gap label, so it trips two
checks. Sloppy CLI usage also fails: a card left in Backlog, closed, deleted,
duplicated, or accompanied by a newly-created extra project card is not a valid
final Todoist state.

It reads the FINAL todoist_cli state over the bench HTTP bridge
(GET ${MOCK_SITE_URL}/__bench/state, header X-Mock-Verifier-Token:
${MOCK_VERIFIER_TOKEN}) and scores it against private/expected_answer.json. It emits
a v2 reward.

Matching is by exact (normalized) card title within the sourcing project; the
section is resolved from the card's section_id via the state's `sections` list.
build_checks(state, expected) is a pure function so the offline gold/naive/
single-slip solvers under scratch/scripts/ score a constructed state the same way;
main() only adds the network fetch + reward I/O.
"""
import argparse
import json
import os
import urllib.request
from pathlib import Path


def chk(cid, passed, reason=""):
    return {"id": cid, "passed": bool(passed), "reason": str(reason)[:300],
            "check_type": "deterministic_exact"}


def norm(s):
    return " ".join(str(s or "").strip().split()).casefold()


def build_checks(state, expected, state_err=""):
    """Pure scorer: given a todoist-bench `state` dict and the ground-truth
    `expected`, return the ordered list of atomic check dicts."""
    want_project = norm(expected["project_name"])
    backlog_section = expected["backlog_section"]
    ready_section = expected["ready_section"]
    resource_section = expected["resource_section"]

    projects = state.get("projects", []) if isinstance(state, dict) else []
    sections = state.get("sections", []) if isinstance(state, dict) else []
    items = state.get("items", []) if isinstance(state, dict) else []

    section_name_by_id = {str(s.get("id")): s.get("name") for s in sections}
    project = next((p for p in projects
                    if norm(p.get("name")) == want_project and not p.get("is_deleted")), None)
    project_id = str(project["id"]) if project else None

    # title -> the single matching card in the project. A title that resolves to
    # >1 card is ambiguous (treated as a miss).
    by_title, dup_titles = {}, set()
    for it in items:
        if it.get("is_deleted"):
            continue
        if project_id is not None and str(it.get("project_id")) != project_id:
            continue
        key = norm(it.get("content"))
        if key in by_title:
            dup_titles.add(key)
        by_title[key] = it

    def find(title):
        key = norm(title)
        if key in dup_titles:
            return None, "ambiguous"
        it = by_title.get(key)
        return (it, "ok") if it is not None else (None, "missing")

    def item_labels(it):
        lb = it.get("labels") if it else None
        return {norm(x) for x in lb} if isinstance(lb, list) else set()

    def is_active(it):
        return bool(it) and not it.get("is_completed") and not it.get("is_deleted")

    sfx = f" ({state_err})" if state_err else ""
    checks = []

    # 0. Fail loud if the mock state could not be read.
    checks.append(chk("mock_reachable",
                      isinstance(state, dict) and bool(items) and project is not None and not state_err,
                      state_err or "todoist bench state read over MOCK_SITE_URL"))

    # 1 + 2. Per item: correct section + correct gap-label presence/absence.
    for item in expected["items"]:
        title = item["title"]
        covered = bool(item["covered"])
        want_section = ready_section if covered else resource_section
        it, status = find(title)

        got_section = section_name_by_id.get(str(it.get("section_id"))) if it else None
        sec_ok = is_active(it) and norm(got_section) == norm(want_section)
        checks.append(chk(f"section::{title}", sec_ok,
                          f"expected section '{want_section}', got '{got_section or status}'"
                          f"{' (not active)' if it and not is_active(it) else ''}{sfx}"))

        want_labels = {norm(x) for x in item.get("labels", [])}
        got_labels = item_labels(it)
        labels_ok = is_active(it) and got_labels == want_labels
        checks.append(chk(f"labels::{title}", labels_ok,
                          f"expected labels {sorted(want_labels)}, got {sorted(got_labels)}"
                          + f" (state={status})"
                          + (" (not active)" if it and not is_active(it) else "") + sfx))

    expected_titles = {norm(item["title"]) for item in expected["items"]}
    active_project_items = [
        it for it in items
        if project_id is not None
        and str(it.get("project_id")) == project_id
        and is_active(it)
    ]
    active_titles = [norm(it.get("content")) for it in active_project_items]
    checks.append(chk("exact_active_card_set",
                      len(active_project_items) == len(expected["items"])
                      and set(active_titles) == expected_titles
                      and len(active_titles) == len(set(active_titles)),
                      f"expected exactly the {len(expected['items'])} original active cards, "
                      f"found {len(active_project_items)} active cards; "
                      f"extra={sorted(set(active_titles) - expected_titles)} "
                      f"missing={sorted(expected_titles - set(active_titles))}{sfx}"))

    backlog_items = [
        it for it in active_project_items
        if norm(section_name_by_id.get(str(it.get("section_id")))) == norm(backlog_section)
    ]
    checks.append(chk("backlog_empty",
                      len(backlog_items) == 0,
                      f"expected no active cards left in '{backlog_section}', "
                      f"found {[it.get('content') for it in backlog_items[:10]]}{sfx}"))

    return checks


def score(checks):
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    return passed, total, (round(passed / total, 4) if total else 0.0)


def fetch_state(url, token):
    req = urllib.request.Request(url, headers={"X-Mock-Verifier-Token": token})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


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
        (out_dir / "mock_todoist_final_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass

    checks = build_checks(state, expected, state_err)
    passed, total, reward = score(checks)
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
