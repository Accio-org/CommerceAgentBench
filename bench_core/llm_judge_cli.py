from __future__ import annotations

import argparse
import fnmatch
import json
import re
import zipfile
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

from .llm_judge import JudgeConfig, build_artifact_context, build_judge_prompt, load_json, run_llm_judge


TEMP_FILE_SUFFIXES = {".py", ".js", ".ts", ".tmp", ".cache", ".log", ".pyc"}
TEXT_SUFFIXES = {".css", ".csv", ".html", ".htm", ".js", ".json", ".md", ".txt", ".xml", ".yaml", ".yml"}


def read_text(path: Path, limit: int = 200000) -> str:
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")[:limit]


def is_supported_image(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 512:
        return False
    head = path.read_bytes()[:16]
    return (
        head.startswith(b"\x89PNG\r\n\x1a\n")
        or head.startswith(b"\xff\xd8\xff")
        or (head.startswith(b"RIFF") and head[8:12] == b"WEBP")
    )


def is_valid_zip(path: Path, required_prefix: str | None = None) -> bool:
    if not path.is_file():
        return False
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    except (OSError, zipfile.BadZipFile):
        return False
    return bool(names) and (required_prefix is None or any(name.startswith(required_prefix) for name in names))


def xml_text(data: bytes) -> str:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return ""
    return " ".join(text.strip() for text in root.itertext() if text and text.strip())


def docx_text(path: Path, limit: int = 200000) -> str:
    chunks: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if name == "word/document.xml" or name.startswith(("word/header", "word/footer")):
                    text = xml_text(zf.read(name))
                    if text:
                        chunks.append(text)
    except (OSError, zipfile.BadZipFile, KeyError):
        return ""
    return "\n".join(chunks)[:limit]


def docx_table_count(path: Path) -> int:
    try:
        with zipfile.ZipFile(path) as zf:
            root = ET.fromstring(zf.read("word/document.xml"))
    except (OSError, zipfile.BadZipFile, KeyError, ET.ParseError):
        return 0
    return sum(1 for elem in root.iter() if elem.tag.rsplit("}", 1)[-1] == "tbl")


def docx_image_count(path: Path) -> int:
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    except (OSError, zipfile.BadZipFile):
        return 0
    return sum(1 for name in names if name.startswith("word/media/") and not name.endswith("/"))


def parse_xlsx_sheets(path: Path) -> dict[str, int]:
    try:
        with zipfile.ZipFile(path) as zf:
            workbook = ET.fromstring(zf.read("xl/workbook.xml"))
            rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
            rel_targets = {
                rel.attrib.get("Id"): rel.attrib.get("Target", "")
                for rel in rels
                if rel.attrib.get("Id")
            }
            sheets: dict[str, int] = {}
            for sheet in workbook.iter():
                if sheet.tag.rsplit("}", 1)[-1] != "sheet":
                    continue
                name = str(sheet.attrib.get("name", "")).strip()
                rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                target = rel_targets.get(rel_id, "")
                target = target.lstrip("/")
                member = f"xl/{target}" if target and not target.startswith("xl/") else target
                row_count = 0
                if member:
                    try:
                        ws = ET.fromstring(zf.read(member))
                    except (KeyError, ET.ParseError):
                        ws = None
                    if ws is not None:
                        row_count = sum(1 for elem in ws.iter() if elem.tag.rsplit("}", 1)[-1] == "row")
                if name:
                    sheets[name] = row_count
            return sheets
    except (OSError, zipfile.BadZipFile, KeyError, ET.ParseError):
        return {}


def json_path_get(data: Any, dotted_path: str) -> Any:
    current = data
    if dotted_path == "$":
        return current
    for part in dotted_path.split("."):
        if not part:
            continue
        match = re.fullmatch(r"([^\[\]]+)(?:\[(\d+)])?", part)
        if not match:
            return None
        key, index = match.groups()
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None
        if index is not None:
            if not isinstance(current, list):
                return None
            idx = int(index)
            if idx >= len(current):
                return None
            current = current[idx]
    return current


def load_json_file(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def json_leaf_values(data: Any) -> list[Any]:
    if isinstance(data, dict):
        values: list[Any] = []
        for value in data.values():
            values.extend(json_leaf_values(value))
        return values
    if isinstance(data, list):
        values = []
        for item in data:
            values.extend(json_leaf_values(item))
        return values
    return [data]


def validate_required_file(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if not path.is_file():
        return "missing"
    if path.stat().st_size == 0:
        return "empty"
    if suffix == ".json" and load_json_file(path) is None:
        return "invalid_json"
    if suffix == ".pdf" and not path.read_bytes()[:5] == b"%PDF-":
        return "invalid_pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".webp"} and not is_supported_image(path):
        return "invalid_image"
    if suffix == ".docx" and not is_valid_zip(path, "word/"):
        return "invalid_docx"
    if suffix == ".xlsx" and not is_valid_zip(path, "xl/"):
        return "invalid_xlsx"
    if suffix in TEXT_SUFFIXES and not read_text(path, limit=8192).strip():
        return "empty_text"
    return None


def validate_file_checks(output_dir: Path, file_checks: dict[str, Any]) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for rel, raw_checks in file_checks.items():
        checks = raw_checks if isinstance(raw_checks, dict) else {}
        path = output_dir / rel
        failures: list[str] = []
        detail: dict[str, Any] = {"exists": path.is_file(), "size_bytes": path.stat().st_size if path.is_file() else 0}

        min_size = checks.get("min_size_bytes")
        if isinstance(min_size, int) and detail["size_bytes"] < min_size:
            failures.append(f"size_below_{min_size}_bytes")

        if checks.get("valid_image") and not is_supported_image(path):
            failures.append("invalid_image")

        if checks.get("valid_pdf") and (not path.is_file() or path.read_bytes()[:5] != b"%PDF-"):
            failures.append("invalid_pdf")

        if any(
            key in checks
            for key in (
                "text_min_chars",
                "text_min_words",
                "text_max_words",
                "text_required_terms",
                "text_required_regexes",
                "forbidden_terms",
                "html_required_local_refs",
            )
        ):
            text = docx_text(path) if path.suffix.lower() == ".docx" else read_text(path)
            detail["text_chars"] = len(text)
            word_count = len(re.findall(r"\b[\w'-]+\b", text))
            detail["word_count"] = word_count
            min_chars = checks.get("text_min_chars")
            if isinstance(min_chars, int) and len(text.strip()) < min_chars:
                failures.append(f"text_below_{min_chars}_chars")
            min_words = checks.get("text_min_words")
            if isinstance(min_words, int) and word_count < min_words:
                failures.append(f"text_below_{min_words}_words")
            max_words = checks.get("text_max_words")
            if isinstance(max_words, int) and word_count > max_words:
                failures.append(f"text_above_{max_words}_words")
            for term in checks.get("text_required_terms", []) if isinstance(checks.get("text_required_terms"), list) else []:
                if str(term).lower() not in text.lower():
                    failures.append(f"missing_text_term:{term}")
            for pattern in checks.get("text_required_regexes", []) if isinstance(checks.get("text_required_regexes"), list) else []:
                if not re.search(str(pattern), text, flags=re.IGNORECASE):
                    failures.append(f"missing_text_regex:{pattern}")
            for term in checks.get("forbidden_terms", []) if isinstance(checks.get("forbidden_terms"), list) else []:
                if str(term).lower() in text.lower():
                    failures.append(f"forbidden_text_term:{term}")
            for ref in checks.get("html_required_local_refs", []) if isinstance(checks.get("html_required_local_refs"), list) else []:
                if str(ref) not in text:
                    failures.append(f"missing_local_ref:{ref}")

        if any(
            key in checks
            for key in (
                "json_required_paths",
                "json_min_array_lengths",
                "json_exact_array_lengths",
                "json_required_values",
                "json_allowed_values",
                "json_numeric_bounds",
                "json_required_regexes",
                "json_partition_values",
                "json_required_terms_anywhere",
                "json_forbidden_terms_anywhere",
                "json_required_values_anywhere",
                "json_forbidden_values_anywhere",
            )
        ):
            data = load_json_file(path)
            detail["valid_json"] = data is not None
            if data is None:
                failures.append("invalid_json")
            else:
                for required_path in checks.get("json_required_paths", []) if isinstance(checks.get("json_required_paths"), list) else []:
                    value = json_path_get(data, str(required_path))
                    if value is None or value == "":
                        failures.append(f"missing_json_path:{required_path}")
                min_lengths = checks.get("json_min_array_lengths")
                if isinstance(min_lengths, dict):
                    for required_path, min_len in min_lengths.items():
                        value = json_path_get(data, str(required_path))
                        if not isinstance(value, list) or len(value) < int(min_len):
                            failures.append(f"json_array_too_short:{required_path}")
                exact_lengths = checks.get("json_exact_array_lengths")
                if isinstance(exact_lengths, dict):
                    for required_path, expected_len in exact_lengths.items():
                        value = json_path_get(data, str(required_path))
                        if not isinstance(value, list) or len(value) != int(expected_len):
                            failures.append(f"json_array_length_mismatch:{required_path}")
                required_values = checks.get("json_required_values")
                if isinstance(required_values, dict):
                    for required_path, expected in required_values.items():
                        value = json_path_get(data, str(required_path))
                        if value != expected:
                            failures.append(f"json_value_mismatch:{required_path}")
                allowed_values = checks.get("json_allowed_values")
                if isinstance(allowed_values, dict):
                    for required_path, allowed in allowed_values.items():
                        value = json_path_get(data, str(required_path))
                        allowed_list = allowed if isinstance(allowed, list) else [allowed]
                        if value not in allowed_list:
                            failures.append(f"json_value_not_allowed:{required_path}")
                numeric_bounds = checks.get("json_numeric_bounds")
                if isinstance(numeric_bounds, dict):
                    for required_path, bounds in numeric_bounds.items():
                        value = json_path_get(data, str(required_path))
                        try:
                            numeric_value = float(value)
                        except (TypeError, ValueError):
                            failures.append(f"json_value_not_numeric:{required_path}")
                            continue
                        if isinstance(bounds, dict):
                            min_value = bounds.get("min")
                            max_value = bounds.get("max")
                            if isinstance(min_value, (int, float)) and numeric_value < float(min_value):
                                failures.append(f"json_number_below_{min_value}:{required_path}")
                            if isinstance(max_value, (int, float)) and numeric_value > float(max_value):
                                failures.append(f"json_number_above_{max_value}:{required_path}")
                required_regexes = checks.get("json_required_regexes")
                if isinstance(required_regexes, dict):
                    for required_path, pattern in required_regexes.items():
                        value = json_path_get(data, str(required_path))
                        patterns = pattern if isinstance(pattern, list) else [pattern]
                        value_text = "" if value is None else str(value)
                        for item in patterns:
                            if not re.search(str(item), value_text, flags=re.IGNORECASE):
                                failures.append(f"json_regex_mismatch:{required_path}")
                partition = checks.get("json_partition_values")
                if isinstance(partition, dict):
                    paths = partition.get("paths") if isinstance(partition.get("paths"), list) else []
                    id_key = str(partition.get("id_key", "id"))
                    expected_values = [str(item) for item in partition.get("expected_values", [])]
                    actual_values: list[str] = []
                    for required_path in paths:
                        value = json_path_get(data, str(required_path))
                        if not isinstance(value, list):
                            failures.append(f"json_partition_path_not_array:{required_path}")
                            continue
                        for item in value:
                            if isinstance(item, dict):
                                actual_values.append(str(item.get(id_key, "")))
                            else:
                                actual_values.append(str(item))
                    for expected in expected_values:
                        if actual_values.count(expected) != 1:
                            failures.append(f"json_partition_expected_once:{expected}")
                    extras = sorted({item for item in actual_values if item and item not in expected_values})
                    for extra in extras:
                        failures.append(f"json_partition_unexpected_value:{extra}")
                json_text = json.dumps(data, ensure_ascii=False).lower()
                for expected in checks.get("json_required_terms_anywhere", []) if isinstance(checks.get("json_required_terms_anywhere"), list) else []:
                    if str(expected).lower() not in json_text:
                        failures.append(f"missing_json_term:{expected}")
                for forbidden in checks.get("json_forbidden_terms_anywhere", []) if isinstance(checks.get("json_forbidden_terms_anywhere"), list) else []:
                    if str(forbidden).lower() in json_text:
                        failures.append(f"forbidden_json_term:{forbidden}")
                leaf_strings = {str(value) for value in json_leaf_values(data)}
                for expected in checks.get("json_required_values_anywhere", []) if isinstance(checks.get("json_required_values_anywhere"), list) else []:
                    if str(expected) not in leaf_strings:
                        failures.append(f"missing_json_value:{expected}")
                for forbidden in checks.get("json_forbidden_values_anywhere", []) if isinstance(checks.get("json_forbidden_values_anywhere"), list) else []:
                    if str(forbidden) in leaf_strings:
                        failures.append(f"forbidden_json_value:{forbidden}")

        if any(key in checks for key in ("xlsx_required_sheets", "xlsx_min_total_rows", "xlsx_min_rows_per_sheet")):
            sheets = parse_xlsx_sheets(path)
            detail["xlsx_sheets"] = sheets
            if not sheets:
                failures.append("invalid_xlsx")
            for sheet in checks.get("xlsx_required_sheets", []) if isinstance(checks.get("xlsx_required_sheets"), list) else []:
                if str(sheet) not in sheets:
                    failures.append(f"missing_xlsx_sheet:{sheet}")
            min_total_rows = checks.get("xlsx_min_total_rows")
            if isinstance(min_total_rows, int) and sum(sheets.values()) < min_total_rows:
                failures.append(f"xlsx_total_rows_below_{min_total_rows}")
            min_rows_per_sheet = checks.get("xlsx_min_rows_per_sheet")
            if isinstance(min_rows_per_sheet, dict):
                for sheet, min_rows in min_rows_per_sheet.items():
                    if sheets.get(str(sheet), 0) < int(min_rows):
                        failures.append(f"xlsx_sheet_rows_below_{min_rows}:{sheet}")

        if any(key in checks for key in ("docx_min_text_chars", "docx_required_terms", "docx_required_regexes", "docx_min_tables", "docx_min_images")):
            text = docx_text(path)
            table_count = docx_table_count(path)
            image_count = docx_image_count(path)
            detail.update({"docx_text_chars": len(text), "docx_tables": table_count, "docx_images": image_count})
            min_chars = checks.get("docx_min_text_chars")
            if isinstance(min_chars, int) and len(text.strip()) < min_chars:
                failures.append(f"docx_text_below_{min_chars}_chars")
            for term in checks.get("docx_required_terms", []) if isinstance(checks.get("docx_required_terms"), list) else []:
                if str(term).lower() not in text.lower():
                    failures.append(f"missing_docx_term:{term}")
            for pattern in checks.get("docx_required_regexes", []) if isinstance(checks.get("docx_required_regexes"), list) else []:
                if not re.search(str(pattern), text, flags=re.IGNORECASE):
                    failures.append(f"missing_docx_regex:{pattern}")
            min_tables = checks.get("docx_min_tables")
            if isinstance(min_tables, int) and table_count < min_tables:
                failures.append(f"docx_tables_below_{min_tables}")
            min_images = checks.get("docx_min_images")
            if isinstance(min_images, int) and image_count < min_images:
                failures.append(f"docx_images_below_{min_images}")

        results[rel] = {**detail, "pass": not failures, "failures": failures}
    return results


def normalize_score(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def artifact_policy_checks(output_dir: Path | None, rubric: dict[str, Any]) -> dict[str, Any]:
    policy = rubric.get("artifact_policy") if isinstance(rubric.get("artifact_policy"), dict) else {}
    required_files = [str(item) for item in policy.get("required_files", []) if str(item).strip()]
    allowed_extra_globs = [str(item) for item in policy.get("allowed_extra_globs", []) if str(item).strip()]
    file_checks = policy.get("file_checks") if isinstance(policy.get("file_checks"), dict) else {}
    exact_output_files = bool(policy.get("exact_output_files", False))
    task_requires_output_files = bool(policy.get("task_requires_output_files", False) or required_files)

    files: list[Path] = []
    rel_files: list[str] = []
    if output_dir and output_dir.exists():
        files = sorted(path for path in output_dir.rglob("*") if path.is_file())
        rel_files = [str(path.relative_to(output_dir)) for path in files]

    required_status = {
        rel: bool(output_dir and (output_dir / rel).is_file())
        for rel in required_files
    }
    missing_required = [rel for rel, exists in required_status.items() if not exists]
    invalid_required = {
        rel: problem
        for rel in required_files
        if output_dir and (problem := validate_required_file(output_dir / rel)) is not None and problem != "missing"
    }

    def allowed(rel: str) -> bool:
        if rel in required_files:
            return True
        return any(fnmatch.fnmatch(rel, pattern) for pattern in allowed_extra_globs)

    unexpected_files = [rel for rel in rel_files if exact_output_files and not allowed(rel)]
    temp_files = [
        rel
        for rel in rel_files
        if not allowed(rel)
        and (Path(rel).suffix.lower() in TEMP_FILE_SUFFIXES or "__pycache__" in rel or ".DS_Store" in rel)
    ]
    temp_or_unrelated = sorted(set(temp_files + unexpected_files))
    file_check_results = validate_file_checks(output_dir, file_checks) if output_dir and output_dir.exists() else {}
    failed_file_checks = {
        rel: result["failures"]
        for rel, result in file_check_results.items()
        if isinstance(result, dict) and result.get("failures")
    }

    cap = 1.0
    cap_reasons: list[str] = []
    if task_requires_output_files and not rel_files:
        cap = min(cap, 0.55)
        cap_reasons.append("missing_all_output_files")
    if missing_required:
        cap = min(cap, 0.55)
        cap_reasons.append("missing_required_output_files")
    if invalid_required:
        cap = min(cap, 0.55)
        cap_reasons.append("invalid_required_output_files")
    if failed_file_checks:
        cap = min(cap, 0.78)
        cap_reasons.append("failed_artifact_content_checks")
    if temp_or_unrelated:
        cap = min(cap, 0.92)
        cap_reasons.append("outputs_contains_temp_or_unrelated_files")

    return {
        "enabled": task_requires_output_files or exact_output_files,
        "required_files": required_status,
        "missing_required_files": missing_required,
        "invalid_required_files": invalid_required,
        "exact_output_files": exact_output_files,
        "allowed_extra_globs": allowed_extra_globs,
        "output_files": {
            "file_count": len(rel_files),
            "files": rel_files,
            "temp_or_unrelated_files": temp_or_unrelated,
        },
        "file_checks": file_check_results,
        "failed_file_checks": failed_file_checks,
        "cap": round(cap, 4),
        "cap_reasons": cap_reasons,
        "passable": not cap_reasons,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="commerce-agent-bench-llm-judge")
    parser.add_argument("--provider", choices=["openai", "gemini", "mock"], required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--task-md", type=Path, required=True)
    parser.add_argument("--rubric-json", type=Path, required=True)
    parser.add_argument("--result-json", type=Path, required=True)
    parser.add_argument("--trajectory-json", type=Path)
    parser.add_argument("--script-reward-json", type=Path)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prompt-out", type=Path)
    parser.add_argument("--base-url")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args(argv)

    rubric = load_json(args.rubric_json, {})
    hard_checks = artifact_policy_checks(args.output_dir, rubric if isinstance(rubric, dict) else {})
    input_dir = args.input_dir
    if input_dir is None:
        candidate = args.task_md.parent / "files"
        input_dir = candidate if candidate.exists() else None
    artifact_summary, media_parts = build_artifact_context(args.output_dir, input_dir=input_dir)
    artifact_summary = (
        f"{artifact_summary}\n\nHard artifact checks:\n"
        f"{json.dumps(hard_checks, ensure_ascii=False, indent=2)}"
    )
    prompt = build_judge_prompt(
        task_md=args.task_md.read_text(encoding="utf-8"),
        rubric=rubric,
        result_json=load_json(args.result_json, {}),
        trajectory=load_json(args.trajectory_json, {}) if args.trajectory_json else {},
        script_reward=load_json(args.script_reward_json, {}) if args.script_reward_json else {},
        artifact_summary=artifact_summary,
    )
    if args.prompt_out:
        args.prompt_out.parent.mkdir(parents=True, exist_ok=True)
        args.prompt_out.write_text(prompt, encoding="utf-8")

    judgment = run_llm_judge(
        JudgeConfig(
            provider=args.provider,
            model=args.model,
            timeout_sec=args.timeout,
            base_url=args.base_url,
            api_key=args.api_key,
        ),
        prompt,
        media_parts,
    )
    try:
        minimum_pass_score = float(rubric.get("minimum_pass_score", 0.8))
    except (TypeError, ValueError):
        minimum_pass_score = 0.8
    judge_score = normalize_score(judgment.get("score", 0.0))
    score = min(judge_score, normalize_score(hard_checks.get("cap", 1.0)))
    if score != judge_score:
        judgment["judge_score_before_hard_cap"] = judge_score
    judgment["score"] = score
    judgment["reward"] = score
    judgment["minimum_pass_score"] = minimum_pass_score
    judgment["hard_checks"] = hard_checks
    judgment["weaknesses"] = list(hard_checks.get("cap_reasons") or []) + list(judgment.get("weaknesses") or [])
    judgment["passed"] = bool(judgment.get("passed")) and score >= minimum_pass_score and bool(hard_checks.get("passable", True))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(judgment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(judgment, ensure_ascii=False, indent=2))
    return 0 if judgment.get("passed") else 6


if __name__ == "__main__":
    raise SystemExit(main())
