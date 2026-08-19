"""Normalization helpers for mock form verifier values.

These helpers intentionally cover only presentation-level differences that are
not exposed as a strict schema in the task prompt: JSON key spelling, numeric
strings vs numbers, display names vs enum ids, and harmless extra fields.
They should not turn wrong business values into passing values.
"""

from __future__ import annotations

import json
import re
from typing import Any


COUNTRY_CODES = {
    "united states": "US",
    "us": "US",
    "usa": "US",
    "united kingdom": "UK",
    "uk": "UK",
    "great britain": "UK",
    "germany": "DE",
    "de": "DE",
    "france": "FR",
    "fr": "FR",
    "canada": "CA",
    "ca": "CA",
    "australia": "AU",
    "au": "AU",
    "japan": "JP",
    "jp": "JP",
    "india": "IN",
    "in": "IN",
    "italy": "IT",
    "it": "IT",
    "spain": "ES",
    "es": "ES",
    "korea": "KR",
    "south korea": "KR",
    "kr": "KR",
    "brazil": "BR",
    "br": "BR",
}


ENUM_ALIASES = {
    "google ads": "google_ads",
    "google_ads": "google_ads",
    "meta ads": "meta_ads",
    "meta_ads": "meta_ads",
    "tiktok ads": "tiktok_ads",
    "tik tok ads": "tiktok_ads",
    "tiktok_ads": "tiktok_ads",
    "credit card": "credit_card",
    "credit_card": "credit_card",
    "paypal": "paypal",
    "pay pal": "paypal",
    "apple pay": "apple_pay",
    "apple_pay": "apple_pay",
    "klarna": "klarna",
}


def parse_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith(("{", "[")):
            try:
                return json.loads(text)
            except Exception:
                return value
    return value


def number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    text = text.replace("+", "").replace("%", "")
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def num_equal(actual: Any, expected: Any, tol: float = 0.01) -> bool:
    a = number(actual)
    e = number(expected)
    return a is not None and e is not None and abs(a - e) <= tol


def boolish(value: Any) -> bool | None:
    text = str(value or "").strip().lower()
    if text in {"true", "yes", "y", "1", "accept", "accepted"}:
        return True
    if text.startswith("i accept"):
        return True
    if text in {"false", "no", "n", "0", "decline", "declined"}:
        return False
    return None


def country_code(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("code") or value.get("countryCode") or value.get("country") or value.get("name")
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return COUNTRY_CODES.get(text, str(value or "").strip().upper())


def enum_value(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return ENUM_ALIASES.get(text, text.replace(" ", "_"))


def _range_from_text(value: Any) -> tuple[float | None, float | None]:
    text = str(value or "").strip().lower()
    text = text.replace("min", "").replace("qty", "").replace("quantity", "").strip()
    if not text:
        return None, None
    if "+" in text:
        return number(text.replace("+", "")), None
    m = re.search(r"(\d+(?:\.\d+)?)\s*[-~to]+\s*(\d+(?:\.\d+)?)", text)
    if m:
        return number(m.group(1)), number(m.group(2))
    return number(text), None


def _get_any(mapping: dict[str, Any], *keys: str) -> Any:
    lowered = {str(k).lower(): v for k, v in mapping.items()}
    for key in keys:
        if key in mapping:
            return mapping[key]
        low = key.lower()
        if low in lowered:
            return lowered[low]
    return None


def normalize_ladder(value: Any, value_key: str = "price") -> list[tuple[float | None, float | None, float | None]]:
    data = parse_jsonish(value)
    out: list[tuple[float | None, float | None, float | None]] = []
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        start = _get_any(item, "min_qty", "minQty", "minQuantity", "min", "from")
        end = _get_any(item, "max_qty", "maxQty", "maxQuantity", "max", "to")
        qty = _get_any(item, "quantity", "qty", "range", "quantityRange", "quantity_range")
        if start is None:
            start, parsed_end = _range_from_text(qty)
            end = end if end is not None else parsed_end
        start_num = number(start)
        end_num = number(end)
        if start_num is not None and start_num > 0 and end_num == 0:
            end_num = None
        amount = _get_any(item, value_key, "fobUsd", "fob_usd", "discountedPrice", "discounted_price", "exwRmb")
        out.append((start_num, end_num, number(amount)))
    return sorted(out, key=lambda row: (-1 if row[0] is None else row[0]))


def normalize_days(value: Any) -> list[tuple[float | None, float | None, float | None]]:
    data = parse_jsonish(value)
    out: list[tuple[float | None, float | None, float | None]] = []
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        start = _get_any(item, "min_qty", "minQty", "minQuantity", "min", "from")
        end = _get_any(item, "max_qty", "maxQty", "maxQuantity", "max", "to")
        qty = _get_any(item, "quantity", "qty", "range", "quantityRange", "quantity_range")
        if start is None:
            start, parsed_end = _range_from_text(qty)
            end = end if end is not None else parsed_end
        start_num = number(start)
        end_num = number(end)
        if start_num is not None and start_num > 0 and end_num == 0:
            end_num = None
        out.append((start_num, end_num, number(_get_any(item, "days", "deliveryDays"))))
    return sorted(out, key=lambda row: (-1 if row[0] is None else row[0]))


def normalize_country_rates(value: Any) -> dict[str, float | None]:
    data = parse_jsonish(value)
    out: dict[str, float | None] = {}
    if isinstance(data, dict):
        if isinstance(data.get("prices"), dict):
            data = data["prices"]
        elif isinstance(data.get("rates"), dict):
            data = data["rates"]
        elif isinstance(data.get("surcharges"), dict):
            data = data["surcharges"]
        elif isinstance(data.get("values"), dict):
            data = data["values"]
        elif isinstance(data.get("items"), list):
            data = data["items"]
        elif isinstance(data.get("rules"), list):
            data = data["rules"]
    if isinstance(data, dict):
        for key, raw in data.items():
            if str(key).strip().lower() in {"mode", "type", "unit", "currency"}:
                continue
            vals = raw if isinstance(raw, list) else [raw]
            nums = [number(v) for v in vals if number(v) is not None]
            out[country_code(key)] = nums[0] if nums else None
    elif isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            code = country_code(_get_any(item, "code", "countryCode", "country", "region", "name"))
            raw = _get_any(
                item,
                "percent", "value", "markup", "surcharge_pct", "surcharge", "rate",
                "markupPercent", "markup_percent", "adjustmentPercent", "adjustment_percent", "diff",
            )
            out[code] = number(raw)
    return out


def normalize_country_set(value: Any) -> set[str]:
    data = parse_jsonish(value)
    if isinstance(data, list):
        return {country_code(item) for item in data if country_code(item)}
    return set()


def normalize_dimensions(value: Any) -> dict[str, float | None]:
    data = parse_jsonish(value)
    if not isinstance(data, dict):
        return {}
    aliases = {
        "length": {"length", "length_cm", "lengthcm"},
        "width": {"width", "width_cm", "widthcm"},
        "height": {"height", "height_cm", "heightcm"},
    }
    low = {str(k).lower(): v for k, v in data.items()}
    out: dict[str, float | None] = {}
    for canonical, names in aliases.items():
        for name in names:
            if name in low:
                out[canonical] = number(low[name])
                break
    return out


def normalize_allocations(value: Any) -> dict[str, dict[str, Any]]:
    data = parse_jsonish(value)
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        wh = str(_get_any(item, "warehouse", "warehouseCode", "warehouse_code") or "").strip()
        if not wh:
            continue
        out[wh] = {
            "units": number(_get_any(item, "units", "allocatedUnits", "allocated_units")),
            "cartons": number(_get_any(item, "cartons", "cartonCount", "carton_count")),
            "method": str(_get_any(item, "shipping_method", "shippingMethod", "method") or "").strip().lower(),
        }
    return out


def normalize_warehouse_map(value: Any) -> dict[str, float | None]:
    data = parse_jsonish(value)
    out: dict[str, float | None] = {}
    if isinstance(data, dict):
        for key, raw in data.items():
            out[str(key)] = number(raw)
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                wh = str(_get_any(item, "warehouse", "warehouseCode", "warehouse_code") or "")
                out[wh] = number(_get_any(item, "units", "allocatedUnits", "allocated_units"))
    return out


def normalize_discount_tiers(value: Any) -> dict[str, dict[str, float | None]]:
    data = parse_jsonish(value)
    out: dict[str, dict[str, float | None]] = {}
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        phase = str(_get_any(item, "phase", "name") or "").strip().lower()
        if phase in {"1", "2", "3"}:
            phase = str(_get_any(item, "name", "phaseName", "phase_name") or phase).strip().lower()
        if not phase:
            continue
        out[phase] = {
            "discount": number(_get_any(item, "discount_pct", "discountPct", "discount")),
            "price": number(_get_any(item, "price", "discountedPrice", "discounted_price")),
            "days": number(_get_any(item, "days", "duration_days", "durationDays")),
        }
    return out


def normalize_enum_list(value: Any) -> set[str]:
    data = parse_jsonish(value)
    if isinstance(data, list):
        return {enum_value(item) for item in data}
    return set()


def _compare_ladder(actual: Any, expected: Any, *, value_key: str = "price") -> bool:
    a = normalize_ladder(actual, value_key=value_key)
    e = normalize_ladder(expected, value_key=value_key)
    if len(a) != len(e):
        return False
    for (a_start, a_end, a_price), (e_start, e_end, e_price) in zip(a, e):
        if not num_equal(a_start, e_start, tol=0.001):
            return False
        if a_end is not None and e_end is not None and not num_equal(a_end, e_end, tol=0.001):
            return False
        if not num_equal(a_price, e_price):
            return False
    return True


def _compare_country_rates(actual: Any, expected: Any) -> bool:
    a = normalize_country_rates(actual)
    e = normalize_country_rates(expected)
    if not e:
        return False
    for key, exp in e.items():
        if key not in a:
            if not num_equal(0, exp):
                return False
            continue
        if not num_equal(a[key], exp):
            return False
    return all(key in e or num_equal(value, 0) for key, value in a.items())


def _range_start_equal(actual_start: Any, expected_start: Any, actual_end: Any, expected_end: Any) -> bool:
    if num_equal(actual_start, expected_start, tol=0.001):
        return True
    a = number(actual_start)
    e = number(expected_start)
    if a is None or e is None:
        return False
    if actual_end is None and expected_end is None and abs(a - e) <= 1:
        return True
    return False


def compare_form_value(field_name: str, actual: Any, expected: Any, *, as_json: bool = False) -> bool:
    actual = parse_jsonish(actual)
    expected = parse_jsonish(expected)

    if isinstance(expected, list) and not as_json:
        return any(compare_form_value(field_name, actual, alt, as_json=False) for alt in expected)

    if field_name == "agreement":
        return boolish(actual) == boolish(expected) and boolish(expected) is not None

    if field_name == "attr_resolution":
        text = str(actual or "").lower()
        return "1920x1080" in text and ("1080p" in text or "full hd" in text or str(actual).strip() == str(expected).strip())

    if field_name == "attr_connectivity":
        text = str(actual or "").lower()
        return "wifi 6" in text and "bluetooth 5.2" in text

    if field_name in {"ladderPrice"}:
        return _compare_ladder(actual, expected)

    if field_name in {"deliveryPeriod"}:
        a = normalize_days(actual)
        e = normalize_days(expected)
        if len(a) != len(e):
            return False
        return all(
            _range_start_equal(ar[0], er[0], ar[1], er[1])
            and (ar[1] is None or er[1] is None or num_equal(ar[1], er[1], tol=0.001))
            and num_equal(ar[2], er[2], tol=0.001)
            for ar, er in zip(a, e)
        )

    if field_name in {"countryPriceDiff", "regionSurcharge"}:
        return _compare_country_rates(actual, expected)

    if field_name in {"selectedCountries", "targetRegions"}:
        return normalize_country_set(actual) == normalize_country_set(expected)

    if field_name == "cartonDimensions":
        a = normalize_dimensions(actual)
        e = normalize_dimensions(expected)
        return bool(e) and all(k in a and num_equal(a[k], v, tol=0.001) for k, v in e.items())

    if field_name == "warehouseAllocations":
        a = normalize_allocations(actual)
        e = normalize_allocations(expected)
        if set(a) != set(e):
            return False
        for key, exp in e.items():
            got = a[key]
            if not num_equal(got["units"], exp["units"], tol=0.001):
                return False
            if exp["method"] and got["method"] and got["method"] != exp["method"]:
                return False
            if got["cartons"] is not None and exp["cartons"] is not None and not num_equal(got["cartons"], exp["cartons"], tol=0.001):
                return False
        return True

    if field_name == "warehouseAllocation":
        a = normalize_warehouse_map(actual)
        e = normalize_warehouse_map(expected)
        return bool(e) and set(a) == set(e) and all(num_equal(a[k], e[k], tol=0.001) for k in e)

    if field_name == "discountTiers":
        a = normalize_discount_tiers(actual)
        e = normalize_discount_tiers(expected)
        if set(a) != set(e):
            return False
        for key, exp in e.items():
            got = a[key]
            if not num_equal(got["discount"], exp["discount"], tol=0.001):
                return False
            if not num_equal(got["price"], exp["price"]):
                return False
            if got["days"] is not None and exp["days"] is not None and not num_equal(got["days"], exp["days"], tol=0.001):
                return False
        return True

    if field_name in {"adPlatforms", "paymentMethods"}:
        return normalize_enum_list(actual) == normalize_enum_list(expected)

    if as_json:
        return _deep_subset_equal(actual, expected)

    if str(actual).strip() == str(expected).strip():
        return True
    if str(actual).strip().lower() == str(expected).strip().lower():
        return True
    return num_equal(actual, expected)


def _deep_subset_equal(actual: Any, expected: Any) -> bool:
    actual = parse_jsonish(actual)
    expected = parse_jsonish(expected)
    if isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            return False
        used: set[int] = set()
        for exp in expected:
            found = None
            for idx, got in enumerate(actual):
                if idx in used:
                    continue
                if _deep_subset_equal(got, exp):
                    found = idx
                    break
            if found is None:
                return False
            used.add(found)
        return True
    if isinstance(actual, dict) and isinstance(expected, dict):
        return all(key in actual and _deep_subset_equal(actual[key], val) for key, val in expected.items())
    if number(actual) is not None and number(expected) is not None:
        return num_equal(actual, expected)
    return actual == expected
