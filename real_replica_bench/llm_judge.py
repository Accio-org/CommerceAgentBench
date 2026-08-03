from __future__ import annotations

import json
import base64
import hashlib
import mimetypes
import os
import re
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "score": {"type": "number", "description": "Overall score from 0.0 to 1.0."},
        "passed": {"type": "boolean", "description": "Whether the answer passes the rubric."},
        "summary": {"type": "string", "description": "Brief judgment summary."},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {"type": "array", "items": {"type": "string"}},
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "score": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["id", "score", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["score", "passed", "summary", "strengths", "weaknesses", "criteria"],
    "additionalProperties": False,
}


@dataclass
class JudgeConfig:
    provider: str
    model: str
    timeout_sec: int = 120
    base_url: str | None = None
    api_key: str | None = None


def load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def extract_response_text(result: Any) -> str:
    root = result[0] if isinstance(result, list) and result else result
    if not isinstance(root, dict):
        return ""
    results = root.get("results")
    if isinstance(results, list) and results:
        chat_result = next((r for r in results if isinstance(r, dict) and r.get("actionType") == "chat"), None)
        pick = chat_result if chat_result is not None else (results[-1] if isinstance(results[-1], dict) else None)
        if pick is not None:
            return str(pick.get("responseText") or "")
    return str(root.get("responseText") or "")


TEXT_MIME_PREFIXES = ("text/",)
TEXT_SUFFIXES = {
    ".csv",
    ".html",
    ".htm",
    ".json",
    ".md",
    ".rtf",
    ".tsv",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
OFFICE_SUFFIXES = {".docx", ".pptx", ".xlsx"}
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_ARTIFACT_FILES = 50
MAX_ARTIFACT_TEXT_CHARS = 60000
MAX_ARTIFACT_FILE_CHARS = 12000
MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024
MAX_INLINE_IMAGES = 12


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_read_text(path: Path, limit: int = MAX_ARTIFACT_FILE_CHARS) -> str:
    data = path.read_bytes()[: limit * 4]
    text = data.decode("utf-8", errors="replace")
    return text[:limit]


def xml_text(data: bytes) -> str:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return ""
    parts = [text.strip() for text in root.itertext() if text and text.strip()]
    return " ".join(parts)


def zip_xml_text(path: Path, members: list[str], limit: int = MAX_ARTIFACT_FILE_CHARS) -> str:
    chunks: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            for name in members:
                if name.endswith("/"):
                    selected = sorted(n for n in zf.namelist() if n.startswith(name) and n.endswith(".xml"))
                else:
                    selected = [name] if name in zf.namelist() else []
                for member in selected:
                    text = xml_text(zf.read(member))
                    if text:
                        chunks.append(f"[{member}] {text}")
                    if sum(len(c) for c in chunks) >= limit:
                        break
                if sum(len(c) for c in chunks) >= limit:
                    break
    except (OSError, zipfile.BadZipFile, KeyError):
        return ""
    return "\n".join(chunks)[:limit]


def extract_office_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return zip_xml_text(
            path,
            [
                "word/document.xml",
                "word/header",
                "word/footer",
                "word/footnotes.xml",
                "word/endnotes.xml",
            ],
        )
    if suffix == ".pptx":
        return zip_xml_text(path, ["ppt/slides/"])
    if suffix == ".xlsx":
        return zip_xml_text(path, ["xl/sharedStrings.xml", "xl/worksheets/"])
    return ""


def append_file_context(
    *,
    lines: list[str],
    media_parts: list[dict[str, Any]],
    root: Path | None,
    label: str,
    text_budget: int,
    inline_images_used: int,
) -> tuple[int, int]:
    if root is None:
        lines.append(f"{label}: not provided.")
        return text_budget, inline_images_used
    if not root.exists():
        lines.append(f"{label}: directory does not exist: {root}")
        return text_budget, inline_images_used

    files = sorted(p for p in root.rglob("*") if p.is_file())
    lines.extend(
        [
            f"{label}: {root}",
            f"{label} file count: {len(files)}",
        ]
    )

    for index, path in enumerate(files[:MAX_ARTIFACT_FILES], start=1):
        rel = path.relative_to(root)
        size = path.stat().st_size
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        digest = sha256_file(path)
        lines.append(f"\n[{label} #{index}] {rel}")
        lines.append(f"- mime: {mime}")
        lines.append(f"- size_bytes: {size}")
        lines.append(f"- sha256: {digest}")

        extracted = ""
        suffix = path.suffix.lower()
        if mime.startswith(TEXT_MIME_PREFIXES) or suffix in TEXT_SUFFIXES:
            extracted = safe_read_text(path)
        elif suffix in OFFICE_SUFFIXES:
            extracted = extract_office_text(path)

        if extracted and text_budget > 0:
            clipped = extracted[: min(len(extracted), MAX_ARTIFACT_FILE_CHARS, text_budget)]
            text_budget -= len(clipped)
            lines.append("- extracted_text:")
            lines.append("```")
            lines.append(clipped)
            lines.append("```")
        elif mime in IMAGE_MIMES:
            if inline_images_used < MAX_INLINE_IMAGES and size <= MAX_INLINE_IMAGE_BYTES:
                media_parts.extend(
                    [
                        {"text": f"{label} image #{index}: {rel}"},
                        {
                            "inlineData": {
                                "mimeType": mime,
                                "data": base64.b64encode(path.read_bytes()).decode("ascii"),
                            }
                        },
                    ]
                )
                inline_images_used += 1
                lines.append("- image_attachment: included as multimodal judge input")
            elif size > MAX_INLINE_IMAGE_BYTES:
                lines.append("- image_attachment: skipped because file is larger than inline limit")

    if len(files) > MAX_ARTIFACT_FILES:
        lines.append(f"\nAdditional {label} files omitted from prompt: {len(files) - MAX_ARTIFACT_FILES}")
    if not files:
        lines.append(f"No files were found in {label}.")
    return text_budget, inline_images_used


def build_artifact_context(output_dir: Path | None, input_dir: Path | None = None) -> tuple[str, list[dict[str, Any]]]:
    lines = ["File evidence passed to the judge:"]
    media_parts: list[dict[str, Any]] = []
    text_budget = MAX_ARTIFACT_TEXT_CHARS
    inline_images_used = 0

    text_budget, inline_images_used = append_file_context(
        lines=lines,
        media_parts=media_parts,
        root=input_dir,
        label="Input source files",
        text_budget=text_budget,
        inline_images_used=inline_images_used,
    )
    lines.append("")
    text_budget, inline_images_used = append_file_context(
        lines=lines,
        media_parts=media_parts,
        root=output_dir,
        label="Produced artifacts",
        text_budget=text_budget,
        inline_images_used=inline_images_used,
    )
    lines.append(f"\nInline image attachments included: {inline_images_used}")
    return "\n".join(lines), media_parts


def build_judge_prompt(
    *,
    task_md: str,
    rubric: Any,
    result_json: Any,
    trajectory: Any,
    script_reward: Any,
    artifact_summary: str = "",
) -> str:
    response_text = extract_response_text(result_json)
    compact_trajectory = {
        "tool_calls": trajectory.get("tool_calls", []) if isinstance(trajectory, dict) else [],
        "tool_progress": trajectory.get("tool_progress", []) if isinstance(trajectory, dict) else [],
        "usage": trajectory.get("usage", {}) if isinstance(trajectory, dict) else {},
    }
    return (
        "You are an impartial but strict benchmark judge. Grade the agent answer against the task and rubric.\n"
        "Return only valid JSON matching this schema:\n"
        f"{json.dumps(JUDGE_SCHEMA, ensure_ascii=False)}\n\n"
        "Scoring rules:\n"
        "- score must be between 0 and 1. Use the full range; do not default to 1.0 for merely plausible work.\n"
        "- passed should be true only when score is at least the rubric minimum_pass_score, or 0.8 if no threshold exists.\n"
        "- Calibrate scores: 1.0 means complete, verified, high-quality work with all required deliverables; 0.8-0.9 means usable with only minor issues; 0.6-0.7 means partial or materially incomplete; below 0.6 means missing core requirements; 0 means no meaningful attempt.\n"
        "- Grade the produced artifacts first when the task asks for files, images, spreadsheets, documents, HTML, PDFs, screenshots, or other deliverables. Final chat text cannot compensate for missing required artifacts.\n"
        "- If required files are absent, saved in the wrong location, unreadable, empty, or only described as a plan, cap the score at 0.55 unless the task explicitly allowed a text-only answer.\n"
        "- Penalize missing required output format, missing sources, unsupported claims, hallucinated URLs/data, failure to use required local files, or failure to use required browser/tool flows.\n"
        "- For image tasks, inspect the attached input/reference images and produced output images when available. Penalize missing visible elements, wrong text, poor composition, or failure to follow the local reference images.\n"
        "- For research/browser tasks, require concrete observations and source grounding; do not reward generic advice that could be written without browsing.\n"
        "- For spreadsheet/document tasks, require traceable calculations, correct columns/sections, and inspectable files when requested.\n"
        "- Do not reward verbosity when required evidence is absent. Prefer a lower score when evidence is thin or unverifiable.\n\n"
        f"Task:\n{task_md}\n\n"
        f"Rubric:\n{json.dumps(rubric, ensure_ascii=False, indent=2)}\n\n"
        f"Script verifier reward:\n{json.dumps(script_reward, ensure_ascii=False, indent=2)}\n\n"
        f"File evidence:\n{artifact_summary or 'No file evidence summary was provided.'}\n\n"
        f"Agent response:\n{response_text}\n\n"
        f"Trajectory summary:\n{json.dumps(compact_trajectory, ensure_ascii=False, indent=2)[:12000]}\n"
    )


def http_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout_sec: int) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            text = resp.read().decode("utf-8")
            parsed = json.loads(text)
            parsed["_http"] = {"status": resp.status, "elapsed_sec": round(time.time() - started, 3)}
            return parsed
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {text[:1000]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed for {url}: {exc}") from exc


def parse_json_text(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("judge response is not a JSON object")
    return normalize_judgment(parsed)


def normalize_judgment(data: dict[str, Any]) -> dict[str, Any]:
    score = data.get("score", 0)
    try:
        score_f = max(0.0, min(1.0, float(score)))
    except Exception:
        score_f = 0.0
    out = {
        "score": score_f,
        "reward": score_f,
        "passed": bool(data.get("passed", score_f >= 0.7)),
        "summary": str(data.get("summary", "")),
        "strengths": data.get("strengths") if isinstance(data.get("strengths"), list) else [],
        "weaknesses": data.get("weaknesses") if isinstance(data.get("weaknesses"), list) else [],
        "criteria": data.get("criteria") if isinstance(data.get("criteria"), list) else [],
    }
    return out


def gemini_response_schema(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {
            key: gemini_response_schema(value)
            for key, value in schema.items()
            if key not in {"additionalProperties"}
        }
    if isinstance(schema, list):
        return [gemini_response_schema(item) for item in schema]
    return schema


def openai_judge(config: JudgeConfig, prompt: str, media_parts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    api_key = config.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for OpenAI judge")
    base_url = (config.base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com").rstrip("/")
    user_content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    for part in media_parts or []:
        if not isinstance(part, dict):
            continue
        if isinstance(part.get("text"), str):
            user_content.append({"type": "input_text", "text": part["text"]})
            continue
        inline_data = part.get("inlineData")
        if not isinstance(inline_data, dict):
            continue
        mime_type = str(inline_data.get("mimeType") or "")
        encoded = str(inline_data.get("data") or "")
        if mime_type.startswith("image/") and encoded:
            user_content.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{mime_type};base64,{encoded}",
                }
            )
    body = {
        "model": config.model,
        "input": [
            {"role": "developer", "content": "You are a strict benchmark judge. Return JSON only."},
            {"role": "user", "content": user_content},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "benchmark_judgment",
                "strict": True,
                "schema": JUDGE_SCHEMA,
            }
        },
    }
    endpoint = f"{base_url}/responses" if base_url.endswith("/v1") else f"{base_url}/v1/responses"
    data = http_json(
        endpoint,
        {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        body,
        config.timeout_sec,
    )
    text = data.get("output_text")
    if not text:
        chunks: list[str] = []
        for item in data.get("output", []) if isinstance(data.get("output"), list) else []:
            if item.get("type") == "message":
                for part in item.get("content", []):
                    if isinstance(part, dict) and "text" in part:
                        chunks.append(str(part["text"]))
        text = "\n".join(chunks)
    judgment = parse_json_text(str(text or ""))
    judgment["provider"] = "openai"
    judgment["model"] = config.model
    judgment["raw_response"] = data
    return judgment


def gemini_judge(config: JudgeConfig, prompt: str, media_parts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    api_key = config.api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for Gemini judge")
    base_url = (config.base_url or os.environ.get("GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com").rstrip("/")
    model = config.model.removeprefix("models/")
    body = {
        "contents": [{"parts": [{"text": prompt}, *(media_parts or [])]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": gemini_response_schema(JUDGE_SCHEMA),
        },
    }
    endpoint = (
        f"{base_url}/models/{model}:generateContent"
        if base_url.endswith("/v1beta")
        else f"{base_url}/v1beta/models/{model}:generateContent"
    )
    data = http_json(
        endpoint,
        {"Content-Type": "application/json", "x-goog-api-key": api_key},
        body,
        config.timeout_sec,
    )
    text = ""
    candidates = data.get("candidates")
    if isinstance(candidates, list) and candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
    if not text.strip():
        raise RuntimeError(f"Gemini judge returned no text: {json.dumps(data, ensure_ascii=False)[:2000]}")
    try:
        judgment = parse_json_text(text)
    except Exception as exc:
        raise RuntimeError(
            f"failed to parse Gemini judge response: text={text[:1000]!r} raw={json.dumps(data, ensure_ascii=False)[:2000]}"
        ) from exc
    judgment["provider"] = "gemini"
    judgment["model"] = config.model
    judgment["raw_response"] = data
    return judgment


def run_llm_judge(config: JudgeConfig, prompt: str, media_parts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    provider = config.provider.lower()
    if provider == "mock":
        return {
            "provider": "mock",
            "model": config.model,
            "score": 1.0,
            "reward": 1.0,
            "passed": True,
            "summary": "Mock judge accepted the response for local harness flow testing.",
            "strengths": ["local flow completed"],
            "weaknesses": [],
            "criteria": [{"id": "mock", "score": 1.0, "reason": "deterministic local test provider"}],
        }
    if provider == "openai":
        return openai_judge(config, prompt, media_parts)
    if provider == "gemini":
        return gemini_judge(config, prompt, media_parts)
    raise ValueError(f"unsupported judge provider: {config.provider}")
