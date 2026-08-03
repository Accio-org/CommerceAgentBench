"""Cheap-script attack for self-review gate 2.

A ~30-line regex/heuristic script that tries to pass the task without
real reasoning. Parses .eml MIME messages from files/inbox/ to extract
the body, then extracts quantity / incoterm / language via shallow
patterns. Emits no contradictions. Should score <= 0.5 if the task's
anti-cheat design is sound.

Usage:
    python3 private/_cheap_attack.py \
      --files-dir files/ --out /tmp/cheap_outputs/
"""

from __future__ import annotations

import argparse
import json
import re
from email import message_from_bytes
from email import policy
from pathlib import Path


LANG_HINTS = {
    "es": ["estimado", "saludos", "cordiales", "compradora", "envíennos", "señor"],
    "de": ["sehr geehrte", "freundlichen grüßen", "anfrage", "stückzahl", "lieferbedingungen"],
    "pt": ["prezados", "atenciosamente", "compradora", "obrigado", "aguardamos"],
    "ar": ["السلام عليكم", "تحيات", "مع التحية", "العربية", "دبي"],
    "en": ["best regards", "kind regards", "hi,", "dear", "sincerely"],
}


def guess_language(text: str) -> str:
    text_l = text.lower()
    scores = {lang: sum(1 for h in hints if h in text_l) for lang, hints in LANG_HINTS.items()}
    return max(scores, key=lambda k: scores[k]) if any(scores.values()) else "en"


def grab_quantity(text: str) -> int:
    for pat in [r"(?:cantidad|stückzahl|quantidade|quantity|الكمية)[^\d]{0,30}([\d.,]+)", r"\b(\d[\d.,]{3,})\s*(?:unidades|einheiten|units|وحدة)\b"]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return int(re.sub(r"[.,]", "", m.group(1)))
    nums = [int(n) for n in re.findall(r"\b\d[\d.,]{2,}\b", text) if int(re.sub(r"[.,]", "", n)) >= 100]
    return nums[0] if nums else 0


def grab_incoterm(text: str) -> str:
    for ic in ["DDP", "DAP", "CIF", "CFR", "FOB", "EXW"]:
        if re.search(rf"\b{ic}\b", text):
            return ic
    return "FOB"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    files_dir = Path(args.files_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    rfqs = []
    inbox_dir = files_dir / "inbox"
    for i, p in enumerate(sorted(inbox_dir.glob("*.eml")), start=1):
        msg = message_from_bytes(p.read_bytes(), policy=policy.default)
        body_part = msg.get_body(preferencelist=("plain",))
        text = body_part.get_content() if body_part is not None else p.read_text(encoding="utf-8", errors="ignore")
        rfqs.append({
            "rfq_id": f"RFQ-{i:02d}",
            "language": guess_language(text),
            "normalized": {"quantity_units": grab_quantity(text), "incoterm": grab_incoterm(text)},
            "contradictions": [],
        })
    payload = {"rfqs": rfqs, "summary": {"total_rfqs": len(rfqs), "total_contradictions": 0}}
    (out_dir / "rfq_analysis.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"wrote {len(rfqs)} rfqs to {out_dir/'rfq_analysis.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
