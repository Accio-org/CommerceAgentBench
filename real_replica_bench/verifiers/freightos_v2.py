"""v2 shared host-side verifier for FreightOS mock tasks.

Covers 4 tasks (freight-booking / freight-booking-rated / freight-booking-fastest /
freight-route-optimization). Emits v2 schema: each sub-criterion (origin_country /
pickup_company / shipment_id etc.) is one atomic deterministic_exact check. No
weights, no thresholds, no length-based checks.

Task supplies ``private/expected_answer.json``. Verifier reads it directly.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any


BOOKING_TASKS = {"freight-booking", "freight-booking-fastest", "freight-booking-rated"}


def _load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig", errors="ignore")
    except Exception:
        return ""


def _fetch_json(base: str, endpoint: str, verifier_token: str) -> Any:
    req = urllib.request.Request(
        f"{base.rstrip('/')}{endpoint}",
        headers={"X-Mock-Verifier-Token": verifier_token},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _contains_any(text: Any, terms: list[str]) -> bool:
    t = _norm(text)
    return any(_norm(term) in t for term in terms)


def _selected_seller_name(state: dict[str, Any]) -> str:
    quote = state.get("selectedQuote")
    if not isinstance(quote, dict):
        return ""
    seller = quote.get("seller")
    if isinstance(seller, dict):
        return str(seller.get("name") or "")
    return str(seller or "")


def _check(check_id: str, passed: bool, reason: Any = "", check_type: str = "deterministic_exact") -> dict:
    return {
        "id": check_id,
        "passed": bool(passed),
        "reason": (reason if isinstance(reason, str) else json.dumps(reason, ensure_ascii=False))[:300],
        "check_type": check_type,
    }


def _search_checks(state: dict, truth: dict, task_id: str) -> list[dict]:
    sd = state.get("searchData") if isinstance(state.get("searchData"), dict) else {}
    expected = truth.get("expected_search_data") or truth.get("route") or {}
    cargo = truth.get("cargo", {}) if isinstance(truth.get("cargo"), dict) else {}
    expected_goods_value = expected.get("goods_value", cargo.get("goods_value_usd", cargo.get("value", 0)))
    expected_cargo = expected.get("cargo_type", "fcl")
    expected_container = str(expected.get("container_size", "40"))
    out = [
        _check("search_origin_country", sd.get("originCountry") == expected.get("origin_country"),
               f"got={sd.get('originCountry')!r} expected={expected.get('origin_country')!r}"),
        _check("search_origin_city",
               sd.get("originCity") == expected.get("origin_city")
               or _contains_any(sd.get("originCityLabel"), expected.get("origin_city_label_contains", [])),
               f"got={sd.get('originCity')!r}"),
        _check("search_dest_country", sd.get("destCountry") == expected.get("dest_country"),
               f"got={sd.get('destCountry')!r} expected={expected.get('dest_country')!r}"),
        _check("search_dest_city",
               sd.get("destCity") == expected.get("dest_city")
               or _contains_any(sd.get("destCityLabel"), expected.get("dest_city_label_contains", [])),
               f"got={sd.get('destCity')!r}"),
        _check("search_cargo_type", str(sd.get("cargoType", "")) == str(expected_cargo),
               f"got={sd.get('cargoType')!r} expected={expected_cargo!r}"),
        _check("search_container_size", expected_container in str(sd.get("containerSize", "")),
               f"got={sd.get('containerSize')!r} expected substring={expected_container!r}"),
        _check("search_container_qty",
               int(sd.get("containerQty") or 0) == int(expected.get("container_qty", cargo.get("quantity", 1))),
               f"got={sd.get('containerQty')!r}"),
        _check("search_goods_value",
               abs(float(sd.get("goodsValue") or 0) - float(expected_goods_value or 0)) <= 1000,
               f"got={sd.get('goodsValue')!r} expected~={expected_goods_value!r}"),
    ]
    if task_id in {"freight-booking", "freight-booking-fastest"}:
        out.append(_check("search_non_hazardous", not bool(sd.get("hazardous")),
                          f"hazardous={sd.get('hazardous')!r}"))
    return out


def _services_checks(state: dict, truth: dict) -> list[dict]:
    services = state.get("servicesData") if isinstance(state.get("servicesData"), dict) else {}
    expected = truth.get("expected_services") or truth.get("services") or {}
    expected_customs = expected.get("customs", expected.get("customs_clearance", True))
    expected_bond = expected.get("bond_type", "single")
    bond_ok = services.get("bondType") == expected_bond or (
        expected_bond == "single_entry" and services.get("bondType") == "single"
    )
    return [
        _check("services_insurance", services.get("insurance") == expected.get("insurance", True),
               f"got={services.get('insurance')!r}"),
        _check("services_customs", services.get("customs") == expected_customs,
               f"got={services.get('customs')!r}"),
        _check("services_bond_type", bond_ok,
               f"got={services.get('bondType')!r} expected~={expected_bond!r}"),
    ]


def _quote_check(state: dict, truth: dict, task_id: str) -> dict:
    selected = state.get("selectedQuoteId")
    if task_id == "freight-booking-rated":
        expected = truth.get("correct_answer", {}).get("quote_id")
    elif task_id == "freight-route-optimization":
        expected = "QT-2026-0813"
    else:
        expected = truth.get("optimal_quote", {}).get("id")
    return _check("quote_selection_correct", selected == expected,
                  f"selected={selected!r} expected={expected!r}")


def _booking_checks(state: dict) -> list[dict]:
    return [
        _check("booking_confirmed", bool(state.get("bookingConfirmed")),
               f"bookingConfirmed={state.get('bookingConfirmed')!r}"),
        _check("shipment_id_present", bool(state.get("shipmentId")),
               f"shipmentId={state.get('shipmentId')!r}"),
    ]


def _verification_checks(state: dict, task_id: str) -> list[dict]:
    data = state.get("verificationData") if isinstance(state.get("verificationData"), dict) else {}
    pickup = data.get("pickup") if isinstance(data.get("pickup"), dict) else {}
    delivery = data.get("delivery") if isinstance(data.get("delivery"), dict) else {}
    blob = _norm(json.dumps(data, ensure_ascii=False))
    if task_id in {"freight-booking", "freight-booking-fastest"}:
        return [
            _check("verification_pickup_company", _contains_any(pickup.get("company"), ["GlobalTrade"]),
                   f"got={pickup.get('company')!r}"),
            _check("verification_pickup_contact", _contains_any(pickup.get("contact"), ["Wang Li"]),
                   f"got={pickup.get('contact')!r}"),
            _check("verification_pickup_email", _norm(pickup.get("email")) == "wangli@globaltrade-elec.com",
                   f"got={pickup.get('email')!r}"),
            _check("verification_delivery_company", _contains_any(delivery.get("company"), ["GlobalTrade", "Distribution"]),
                   f"got={delivery.get('company')!r}"),
            _check("verification_delivery_contact", _contains_any(delivery.get("contact"), ["James Miller"]),
                   f"got={delivery.get('contact')!r}"),
            _check("verification_delivery_email", _norm(delivery.get("email")) == "james.miller@globaltrade-us.com",
                   f"got={delivery.get('email')!r}"),
            _check("verification_pickup_country", pickup.get("country") in {"CN", "China"},
                   f"got={pickup.get('country')!r}"),
            _check("verification_delivery_country", delivery.get("country") in {"US", "United States"},
                   f"got={delivery.get('country')!r}"),
        ]
    if task_id == "freight-booking-rated":
        return [
            _check("verification_pickup_company", "brighttech" in blob, "blob check"),
            _check("verification_pickup_contact", "mei lin" in blob, "blob check"),
            _check("verification_pickup_email", "mei.lin@brighttech-components.cn" in blob, "blob check"),
            _check("verification_delivery_company", "atlantic consumer electronics" in blob, "blob check"),
            _check("verification_delivery_contact", "olivia carter" in blob, "blob check"),
            _check("verification_delivery_email", "olivia.carter@atlantic-ce.example" in blob, "blob check"),
        ]
    # freight-route-optimization
    return [
        _check("verification_pickup_company", "dongguan techparts" in blob, "blob check"),
        _check("verification_pickup_contact", "chen wei" in blob, "blob check"),
        _check("verification_pickup_email", "chenwei@dg-techparts.com" in blob, "blob check"),
        _check("verification_delivery_company", "central us logistics hub" in blob, "blob check"),
        _check("verification_delivery_contact", "robert johnson" in blob, "blob check"),
        _check("verification_delivery_email", "r.johnson@techparts-us.com" in blob, "blob check"),
    ]


def _booking_report_checks(report: str, state: dict) -> list[dict]:
    selected = str(state.get("selectedQuoteId") or "")
    seller = _selected_seller_name(state)
    shipment = str(state.get("shipmentId") or "")
    return [
        _check("report_cites_shipment_id", bool(shipment) and shipment in report,
               f"shipment={shipment!r}"),
        _check("report_cites_selected_quote_id", bool(selected) and selected in report,
               f"selected={selected!r}"),
        _check("report_cites_seller_name", bool(seller) and _norm(seller) in _norm(report),
               f"seller={seller!r}"),
        _check("report_has_pricing_figure", bool(re.search(r"\$?\s*\d[\d,]*(?:\.\d+)?", report)),
               "looks for at least one money/number pattern"),
    ]


def _route_id_present(report: str, route_id: str) -> bool:
    """A route is considered 'cited' if its leg IDs appear ordered within a
    300-char window. Accepts compact form (``D1+O3+L2``, ``D1-O3-L2``) AND
    prose form (``Leg 1: D1 (Dongguan→Shenzhen, ...); Leg 2: O3 (Shenzhen→
    Long Beach, ...); Leg 3: L2 (...)``). task.md does not require a
    specific notation, so this tolerates both styles.
    """
    tokens = [re.escape(part) for part in route_id.split("+")]
    pattern = r"\b" + r"[\s\S]{0,300}?".join(tokens) + r"\b"
    return bool(re.search(pattern, report, re.IGNORECASE))


def _route_report_checks(report: str) -> list[dict]:
    return [
        _check("route_report_cites_d1_o3_l2",
               _route_id_present(report, "D1+O3+L2"),
               "optimal route id"),
        _check("route_report_cites_optimal_cost",
               bool(re.search(r"6[,.]?054(?:\.50|\.5)?", report)),
               "expected cost 6,054.50 (USD)"),
        _check("route_report_cites_30_day_deadline",
               bool(re.search(r"30\s*day|30\s*天|deadline", report, re.IGNORECASE)),
               "30-day deadline mentioned"),
        _check("route_report_calls_out_d2_infeasible",
               _route_id_present(report, "D2+O4+L1"),
               "infeasible D2+O4+L1 mentioned"),
        _check("route_report_calls_out_d3_infeasible",
               _route_id_present(report, "D3+O6+L2"),
               "infeasible D3+O6+L2 mentioned"),
        _check("route_report_enumerates_6plus_routes",
               sum(1 for rid in ["D1+O1+L1", "D1+O2+L1", "D1+O3+L2", "D2+O4+L1", "D3+O5+L1", "D3+O6+L2", "D4+O7+L1", "D4+O8+L1"] if _route_id_present(report, rid)) >= 6,
               "≥6 of 8 candidate routes enumerated"),
    ]


def _mock_integrity_check(access_log: list[dict], verifier_token: str) -> dict:
    valid_token_paths = {
        str(item.get("path"))
        for item in access_log
        if item.get("uiTokenValid") is True and item.get("method") == "POST"
    }
    required_token_paths = {"/search", "/services", "/select-quote", "/confirm", "/verification"}
    missing = sorted(required_token_paths - valid_token_paths)
    return _check(
        "mock_submit_via_legitimate_path",
        bool(verifier_token) and not missing,
        f"missing_required_ui_token_paths={missing}; verifier_token_present={bool(verifier_token)}",
    )


def verify(
    task_dir: Path,
    output_dir: Path,
    reward_json: Path,
    mock_url: str,
) -> dict:
    task_dir = Path(task_dir)
    output_dir = Path(output_dir)
    reward_json = Path(reward_json)
    raw_name = task_dir.name
    # Normalize: directory is "booking-rated" but checks use legacy "freight-booking-rated"
    _LEGACY_PREFIX = {
        "booking": "freight-booking",
        "booking-fastest": "freight-booking-fastest",
        "booking-rated": "freight-booking-rated",
        "route-optimization": "freight-route-optimization",
    }
    task_id = _LEGACY_PREFIX.get(raw_name, raw_name)
    verifier_token = os.environ.get("MOCK_VERIFIER_TOKEN", "")

    expected_path = task_dir / "private" / "expected_answer.json"
    if not expected_path.exists():
        # fall back to grading_truth.json for soft migration
        legacy = task_dir / "private" / "grading_truth.json"
        if legacy.exists():
            truth = _load_json(legacy, {}) or {}
        else:
            return _emit(reward_json, task_id, [_check("expected_answer_loaded", False, "missing private/expected_answer.json")])
    else:
        truth = _load_json(expected_path, {}) or {}

    try:
        state = _fetch_json(mock_url, "/api/booking-state", verifier_token)
        access_log = _fetch_json(mock_url, "/api/access-log", verifier_token)
        if not isinstance(access_log, list):
            access_log = []
    except Exception as exc:
        return _emit(reward_json, task_id, [_check("mock_service_reachable", False, f"{exc}")])

    # Persist mock evidence
    try:
        (output_dir / "mock_audit").mkdir(parents=True, exist_ok=True)
        (output_dir / "mock_state").mkdir(parents=True, exist_ok=True)
        (output_dir / "mock_audit" / "logistics_tracker_audit.json").write_text(
            json.dumps({"service": "logistics_tracker", "access_log": access_log}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (output_dir / "mock_state" / "logistics_tracker_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8",
        )
    except OSError:
        pass

    checks: list[dict] = []
    checks.append(_check("mock_service_reachable", True))
    checks.append(_check(
        "auth_success",
        bool(state.get("authenticated")) and any(
            item.get("path") == "/login" and item.get("success") for item in access_log
        ),
        f"authenticated={state.get('authenticated')!r}",
    ))
    checks.append(_mock_integrity_check(access_log, verifier_token))

    if task_id == "freight-route-optimization":
        route_data_seen = any("/route-planner" in str(item.get("path", "")) for item in access_log)
        checks.append(_check("data_collection_route_planner_visited", route_data_seen,
                             "agent must visit /route-planner endpoint"))
        report = _read_text(output_dir / "route_analysis.md")
        checks.append(_check("route_analysis_md_exists", bool(report), "route_analysis.md missing or empty"))
        checks.append(_quote_check(state, truth, task_id))
        checks.extend(_booking_checks(state))
        checks.extend(_verification_checks(state, task_id))
        checks.extend(_route_report_checks(report))
    else:
        report = _read_text(output_dir / "booking_confirmation.md")
        checks.append(_check("booking_confirmation_md_exists", bool(report),
                             "booking_confirmation.md missing or empty"))
        checks.extend(_search_checks(state, truth, task_id))
        checks.extend(_services_checks(state, truth))
        checks.append(_quote_check(state, truth, task_id))
        checks.extend(_booking_checks(state))
        checks.extend(_verification_checks(state, task_id))
        checks.extend(_booking_report_checks(report, state))

    return _emit(reward_json, task_id, checks)


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
        "source": "v2_freightos",
    }
    reward_json.parent.mkdir(parents=True, exist_ok=True)
    reward_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("score", "checks_passed", "checks_total")}))
    return payload
