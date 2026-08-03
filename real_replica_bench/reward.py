"""Binary/v2 reward computation and capacity scoring.

Extracted verbatim from cli.py (2026-06-18 refactor): pure stdlib, no cli
dependencies. Source of truth for actual_checks_count / capacity_score /
validation_check_breakdown / build_binary_final_reward (re-exported by cli;
also imported by scripts/backfill_v2_report.py).
"""
from __future__ import annotations

from typing import Any


def _score_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return max(0.0, min(1.0, number))


def _explicit_validation_checks(reward: dict[str, Any]) -> list[dict[str, Any]]:
    raw = reward.get("validation_checks")
    if not isinstance(raw, list):
        return []
    checks: list[dict[str, Any]] = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("id") or item.get("name") or f"check_{index}")
        passed = bool(item.get("passed"))
        check: dict[str, Any] = {
            "id": check_id,
            "passed": passed,
        }
        if "score" in item:
            check["score"] = item.get("score")
        if item.get("reason") is not None:
            check["reason"] = str(item.get("reason"))
        checks.append(check)
    return checks


def _minimum_pass_score(reward: dict[str, Any]) -> float:
    for key in ("minimum_pass_score", "threshold"):
        value = _score_or_none(reward.get(key))
        if value is not None:
            return value
    return 0.8


def _criteria_judge_score(reward: dict[str, Any]) -> tuple[float | None, str | None, str | None]:
    criteria = reward.get("criteria")
    if not isinstance(criteria, list):
        return None, None, None
    for item in criteria:
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("id") or "")
        normalized = check_id.lower()
        if "hard" in normalized:
            continue
        if "llm" in normalized or "judge" in normalized or "rubric" in normalized:
            return _score_or_none(item.get("score")), check_id or "llm_rubric_judge", str(item.get("reason") or "")
    return None, None, None


def _llm_rubric_check(reward: dict[str, Any], raw_score: float | None) -> dict[str, Any] | None:
    threshold = _minimum_pass_score(reward)
    llm_judgment = reward.get("llm_judgment")
    score: float | None = None
    source = ""
    reason = ""
    if isinstance(llm_judgment, dict):
        score = _score_or_none(llm_judgment.get("score", llm_judgment.get("reward")))
        source = "llm_judgment"
        reason = str(llm_judgment.get("summary") or "")
    if score is None:
        score = _score_or_none(reward.get("judge_score_before_hard_cap"))
        if score is not None:
            source = "judge_score_before_hard_cap"
    if score is None:
        score, criteria_id, reason = _criteria_judge_score(reward)
        if score is not None:
            source = criteria_id or "criteria"
    if score is None and (
        reward.get("provider")
        or reward.get("model")
        or isinstance(reward.get("criteria"), list)
    ):
        score = raw_score
        source = "raw_verifier_score"
        reason = str(reward.get("summary") or "")
    if score is None:
        return None
    return {
        "id": "llm_rubric_judge",
        "passed": score >= threshold,
        "score": score,
        "threshold": threshold,
        "source": source,
        "reason": reason or str(reward.get("summary") or ""),
    }


def _script_verifier_check(reward: dict[str, Any], raw_score: float | None, raw_passed: bool) -> dict[str, Any]:
    threshold = _minimum_pass_score(reward)
    return {
        "id": "script_verifier",
        "passed": raw_passed and (raw_score is None or raw_score >= threshold),
        "score": raw_score,
        "threshold": threshold,
        "reason": str(reward.get("summary") or ""),
    }


def build_binary_final_reward(
    reward: dict[str, Any],
    *,
    verifier_exit: int,
    agent_exec_returncode: int | None,
    agent_early_terminated: bool = False,
) -> dict[str, Any]:
    """Convert raw verifier output into the comparable benchmark final reward.

    ``verifier/reward.json`` may keep continuous diagnostic scores. The
    externally comparable final reward is binary: every required validation
    check must pass, otherwise reward/score are 0.
    """
    final_reward = dict(reward)
    raw_score = _score_or_none(reward.get("raw_score"))
    raw_reward = _score_or_none(reward.get("raw_reward"))
    if raw_score is None:
        raw_score = _score_or_none(reward.get("score", reward.get("reward")))
    if raw_reward is None:
        raw_reward = _score_or_none(reward.get("reward", reward.get("score")))
    raw_passed = bool(reward.get("passed"))

    verifier_completed = verifier_exit in (0, 6)
    verifier_passed = raw_passed and verifier_completed
    agent_execution_passed = (
        agent_exec_returncode in (0, None)
        or agent_early_terminated
        or verifier_passed
    )
    if agent_exec_returncode in (0, None) or agent_early_terminated:
        agent_execution_reason = "agent process completed successfully"
    elif verifier_passed:
        agent_execution_reason = (
            f"agent_exec_returncode={agent_exec_returncode}; verifier passed, "
            "treating agent process status as diagnostic"
        )
    else:
        agent_execution_reason = f"agent_exec_returncode={agent_exec_returncode}"

    if _is_v2_reward_schema(reward):
        # v2: the raw test.sh check list IS the source of truth. We do NOT
        # add framework meta-checks (agent_execution / verifier_completed /
        # script_verifier_or_llm) on top — those gated v1 scoring and made
        # every report show "x/3" regardless of how many real checks the
        # task had. Binary passed simply requires every raw check to pass
        # AND the verifier to have completed (so the raw data is trustable).
        # An agent crash typically leaves outputs missing and trips raw
        # checks naturally, so we don't gate on agent_execution explicitly.
        breakdown = reward.get("checks_breakdown")
        checks = [
            {
                "id": c.get("id"),
                "passed": bool(c.get("passed")),
                "reason": c.get("reason"),
                "check_type": c.get("check_type"),
            }
            for c in (breakdown if isinstance(breakdown, list) else [])
            if isinstance(c, dict)
        ]
        passed_checks = sum(1 for c in checks if c.get("passed"))
        total_checks = len(checks)
        all_passed = total_checks > 0 and passed_checks == total_checks and verifier_completed
        check_ratio = round(passed_checks / total_checks, 4) if total_checks else 0.0
        raw_score = check_ratio
        raw_reward = check_ratio
        raw_passed = total_checks > 0 and passed_checks == total_checks
        llm_check = None
    else:
        checks = [
            {
                "id": "agent_execution",
                "passed": agent_execution_passed,
                "reason": agent_execution_reason,
            },
            {
                "id": "verifier_completed",
                "passed": verifier_completed,
                "reason": f"verifier_exit={verifier_exit}",
            },
        ]
        llm_check = _llm_rubric_check(reward, raw_score)
        if llm_check is not None:
            checks.append(llm_check)
        else:
            checks.append(_script_verifier_check(reward, raw_score, raw_passed))
        checks.extend(_explicit_validation_checks(reward))
        hard_checks = reward.get("hard_checks")
        if isinstance(hard_checks, dict) and "passable" in hard_checks:
            checks.append(
                {
                    "id": "hard_checks_passable",
                    "passed": bool(hard_checks.get("passable")),
                    "score": hard_checks.get("score"),
                    "reason": "; ".join(str(item) for item in hard_checks.get("cap_reasons", []) or []),
                }
            )
        passed_checks = sum(1 for check in checks if check.get("passed"))
        total_checks = len(checks)
        all_passed = total_checks > 0 and passed_checks == total_checks

    final_reward["raw_reward"] = raw_reward
    final_reward["raw_score"] = raw_score
    final_reward["raw_passed"] = raw_passed
    if llm_check is not None:
        final_reward["llm_rubric_score"] = llm_check.get("score")
        final_reward["llm_rubric_threshold"] = llm_check.get("threshold")
        final_reward["llm_rubric_passed"] = llm_check.get("passed")
    final_reward["reward_mode"] = "binary_all_checks"
    final_reward["validation_checks"] = checks
    final_reward["check_summary"] = {
        "total": total_checks,
        "passed": passed_checks,
        "failed": total_checks - passed_checks,
        "all_passed": all_passed,
    }
    final_reward["framework_signals"] = {
        "agent_execution_passed": agent_execution_passed,
        "agent_execution_reason": agent_execution_reason,
        "verifier_completed": verifier_completed,
        "verifier_exit": verifier_exit,
        "agent_exec_returncode": agent_exec_returncode,
        "agent_early_terminated": agent_early_terminated,
    }
    final_reward["passed"] = all_passed
    final_reward["reward"] = 1.0 if all_passed else 0.0
    final_reward["score"] = final_reward["reward"]
    final_reward.setdefault("verifier_exit", verifier_exit)
    return final_reward


def _is_v2_reward_schema(reward: dict[str, Any]) -> bool:
    if not isinstance(reward, dict):
        return False
    schema = reward.get("schema_version")
    return isinstance(schema, str) and schema.startswith("2.")


def actual_checks_count(reward: dict[str, Any]) -> tuple[int, int]:
    """Return (passed, total) for **actual** test.sh validation checks.

    v2 schema (``schema_version`` >= "2.0") writes per-task ``checks_passed`` /
    ``checks_total`` / ``checks_breakdown`` at the top level — these are the
    real test.sh check counts (e.g. 11/11, 17/17), the source of truth for
    the per-case capacity score.

    v1 fallback: count the non-LLM entries inside ``validation_checks``
    (a list of framework + script meta-checks). For pre-v2 tasks this used
    to coincide with the three framework checks (agent_execution /
    verifier_completed / script_verifier_or_llm), so the old reports showed
    "x/3". The new helper preserves that v1 behaviour while routing v2 tasks
    to their real counts.
    """
    if not isinstance(reward, dict):
        return (0, 0)
    if _is_v2_reward_schema(reward):
        cp = reward.get("checks_passed")
        ct = reward.get("checks_total")
        if isinstance(cp, int) and isinstance(ct, int) and ct > 0:
            return (cp, ct)
        breakdown = reward.get("checks_breakdown")
        if isinstance(breakdown, list) and breakdown:
            return (
                sum(1 for c in breakdown if isinstance(c, dict) and c.get("passed")),
                len(breakdown),
            )
        return (0, 0)
    checks = reward.get("validation_checks")
    checks = checks if isinstance(checks, list) else []
    other_checks = [
        c for c in checks
        if isinstance(c, dict) and c.get("id") != "llm_rubric_judge"
    ]
    return (
        sum(1 for c in other_checks if c.get("passed")),
        len(other_checks),
    )


def capacity_score(reward: dict[str, Any]) -> float | None:
    """Continuous per-case capacity score in [0, 1] = checks_passed / checks_total.

    None when total checks unknown. Distinct from the binary ``score`` field
    (which is 0 or 1 under ``reward_mode=binary_all_checks``).
    """
    passed, total = actual_checks_count(reward)
    if total <= 0:
        return None
    return passed / total


def validation_check_breakdown(reward: dict[str, Any]) -> dict[str, Any]:
    """Per-task check metrics for the summary.json row.

    Returns ``other_checks_passed/total`` (back-compat field names that
    *actually* hold the real test.sh check counts for v2 tasks) plus the LLM
    judge score/pass from the framework meta-checks (still present in
    ``validation_checks`` even for v2 runs).
    """
    checks = reward.get("validation_checks") if isinstance(reward, dict) else None
    checks = checks if isinstance(checks, list) else []
    llm_check = next(
        (
            check
            for check in checks
            if isinstance(check, dict) and check.get("id") == "llm_rubric_judge"
        ),
        None,
    )
    other_passed, other_total = actual_checks_count(reward)
    return {
        "llm_judge_score": llm_check.get("score") if isinstance(llm_check, dict) else None,
        "llm_check_passed": llm_check.get("passed") if isinstance(llm_check, dict) else None,
        "llm_check_threshold": llm_check.get("threshold") if isinstance(llm_check, dict) else None,
        "other_checks_passed": other_passed,
        "other_checks_total": other_total,
        "capacity_score": capacity_score(reward),
    }
