#!/usr/bin/env python3
"""Generate the Gmail seed overlay and hidden answer key for this task.

The generator keeps the hidden world-state and expected final state together.
It deliberately produces a mailbox, not a flat CSV answer table: stale updates,
near-duplicate senders, and unrelated business noise are mixed into the same
Gmail state the agent must operate on through the UI.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "private"
SEEDS = PRIVATE / "mock_runtime" / "gmail_mock" / "seeds"


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def message(
    id_: str,
    sender: str,
    email: str,
    subject: str,
    body: str,
    *,
    date: str = "6月19日",
    full_date: str = "2025年6月19日周四 09:00",
    labels: list[str] | None = None,
    unread: bool = True,
    important: bool = False,
    category: str = "primary",
    attachments: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    attachments = attachments or []
    return {
        "id": id_,
        "category": category,
        "labels": labels or ["inbox"],
        "from": sender,
        "fromEmail": email,
        "to": "ops.coordinator@auroraretail.test",
        "cc": "",
        "bcc": "",
        "subject": subject,
        "snippet": " ".join(body.split())[:180],
        "body": body,
        "date": date,
        "fullDate": full_date,
        "unread": unread,
        "starred": False,
        "important": important,
        "selected": False,
        "hasAttachment": bool(attachments),
        "attachments": attachments,
        "muted": False,
    }


def main() -> None:
    labels = [
        {"id": "inbox", "name": "收件箱", "icon": "inbox", "type": "system"},
        {"id": "starred", "name": "已加星标", "icon": "star", "type": "system"},
        {"id": "snoozed", "name": "已延后", "icon": "clock", "type": "system"},
        {"id": "sent", "name": "已发邮件", "icon": "send", "type": "system"},
        {"id": "drafts", "name": "草稿", "icon": "draft", "type": "system"},
        {"id": "purchases", "name": "购物", "icon": "tag", "type": "system"},
        {"id": "important", "name": "重要邮件", "icon": "important", "type": "system"},
        {"id": "scheduled", "name": "定时发送", "icon": "scheduled", "type": "system"},
        {"id": "all", "name": "所有邮件", "icon": "all", "type": "system"},
        {"id": "spam", "name": "垃圾邮件", "icon": "spam", "type": "system"},
        {"id": "trash", "name": "已删除邮件", "icon": "trash", "type": "system"},
        {"id": "subscriptions", "name": "管理订阅", "icon": "mail_manage", "type": "system"},
        {"id": "manage-labels", "name": "管理标签", "icon": "settings", "type": "system"},
        {"id": "label-launch", "name": "Launch", "icon": "tag", "type": "user", "color": "#1a73e8"},
        {"id": "label-vendors", "name": "Vendors", "icon": "tag", "type": "user", "color": "#188038"},
    ]

    categories = [
        {"id": "primary", "name": "主要", "selected": True, "teaser": "Aurora launch traffic"},
        {"id": "promotions", "name": "促销", "selected": False, "teaser": "Campaign digests"},
        {"id": "social", "name": "社交", "selected": False, "teaser": "Community updates"},
    ]

    messages = [
        message(
            "alp-001-brief",
            "Alice Li",
            "alice.li@auroraretail.test",
            "[ALP-26] Launch pack handoff: triage before 17:00 HKT",
            """Please triage the ALP-26 launch pack today. Create a nested Gmail label under Launch named ALP-26, apply it to the current action threads, and leave saved drafts only.

Critical blockers to star: FCC holder mismatch, latest carton/pickup correction, invoice hold AP-771, and MSDS/air-shipment wording. The owner should be able to open Starred and see only the real blockers, not old ALP-25 or vendor-news items.

Do not send anything yet. Save drafts for compliance, logistics, creative, finance, and support. Use 2025-06-19 as the mock Gmail day.""",
            full_date="2025年6月19日周四 08:14",
            important=True,
        ),
        message(
            "alp-002-fcc",
            "Mei Chen",
            "mei.chen@lumenlabs.test",
            "ALP-26 compliance: FCC attestation holder mismatch on W2K-4529",
            """The FCC attestation attached to W2K-4529 still lists certificate holder Nova Home LLC. The PDP and commercial invoice identify Aurora Retail Ltd.

Please ask Mei for a corrected attestation or written bridge letter by today 18:00 HKT. The launch cannot use the phrase certified for US retail until the holder mismatch is resolved.""",
            full_date="2025年6月19日周四 08:37",
            important=True,
            attachments=[{"id": "att-fcc-bridge", "name": "W2K-4529_attestation_bridge.pdf", "size": "248 KB"}],
        ),
        message(
            "alp-003-logistics-final",
            "Leon Wu",
            "leon.wu@northport-3pl.test",
            "Correction: ALP-26 cartons now 118, WH-3 pickup 14:30-16:00 HKT",
            """Correction to my earlier note: use 118 cartons, not 112. Dock team can release from WH-3 only in the 14:30-16:00 HKT window today. The carrier reference must include ALP26-DCK-118.

Please draft back confirming 118 cartons, WH-3, pickup 14:30-16:00 HKT, and copy ops-launch@auroraretail.test.""",
            full_date="2025年6月19日周四 09:05",
            important=True,
        ),
        message(
            "alp-004-logistics-stale",
            "Leon Wu",
            "leon.wu@northport-3pl.test",
            "Old count for ALP-26: 112 cartons at 10:00",
            """Earlier plan before the warehouse re-count: 112 cartons, pickup around 10:00. This was superseded by my later correction.""",
            full_date="2025年6月19日周四 07:52",
            unread=False,
        ),
        message(
            "alp-005-finance",
            "Priya Raman",
            "priya.raman@auroraretail.test",
            "AP-771 hold requested: recycled insert not on PO line 4",
            """Finance found invoice AP-771 for USD 18,420. It includes the recycled insert charge, but PO line 4 excludes that insert until compliance approves the bridge letter.

Please save a draft to ap-hold@auroraretail.test asking them to hold AP-771, mention USD 18,420, PO line 4, recycled insert, and W2K-4529.""",
            full_date="2025年6月19日周四 09:16",
            important=True,
        ),
        message(
            "alp-006-creative",
            "Nora Patel",
            "nora.patel@auroraretail.test",
            "ALP-26 PDP copy: final assets and claim limits",
            """Creative has final assets ALP26_Hero_v7.jpg and ALP26_certified_claims.png. Remove any phrase saying medical-grade. Safe wording is lab-tested charging dock and recyclable paper insert.

Please draft to Nora confirming both final asset filenames and explicitly tell her to remove medical-grade wording.""",
            full_date="2025年6月19日周四 09:42",
        ),
        message(
            "alp-007-support",
            "VIP Support Queue",
            "vip-support@auroraretail.test",
            "37 VIP preorder replies need ALP-26 canned response",
            """There are 37 VIP preorder emails asking if the launch date moved. Draft the support response with ETA June 23, state that opt-out link stays available, and do not promise air shipment until MSDS clears.""",
            full_date="2025年6月19日周四 10:03",
        ),
        message(
            "alp-008-sku",
            "Marketplace Ops",
            "marketplace.ops@auroraretail.test",
            "SKU mapping: AUR-DOCK-KIT-MIDNIGHT must use new UPC",
            """The SKU AUR-DOCK-KIT-MIDNIGHT is still mapped to the old UPC in the launch checklist. Use UPC 889041-ALP26-MD for ALP-26 and keep the old UPC off marketplace notes.""",
            full_date="2025年6月19日周四 10:24",
        ),
        message(
            "alp-009-msds",
            "Rafiq Mansour",
            "rafiq.mansour@hazmatdesk.test",
            "MSDS not cleared: remove air-shipment-ready claim",
            """Battery accessory MSDS is not cleared for air today. Remove air-shipment-ready from all ALP-26 launch wording until the MSDS clearance arrives. Ground shipping copy is acceptable.""",
            full_date="2025年6月19日周四 10:48",
            important=True,
        ),
        message(
            "alp-010-exec-hold",
            "Marta Gomez",
            "marta.gomez@auroraretail.test",
            "ALP-26 launch note hold until blockers are closed",
            """Please keep the launch note in draft until the four blockers Alice listed are closed. I only need visibility that the threads are labeled and starred correctly.""",
            full_date="2025年6月19日周四 11:12",
        ),
        message(
            "decoy-001-alp25",
            "Alice Li",
            "alice.li@auroraretail.test",
            "[ALP-25] last quarter dock launch retro",
            "Old ALP-25 retro notes. Useful context only; do not label this as ALP-26 current work.",
            date="5月02日",
            full_date="2025年5月2日周五 13:00",
            unread=False,
        ),
        message(
            "decoy-002-near-sender",
            "Alice Li",
            "alice.li@aurora-retail.test",
            "[ALP-26] partner webinar sponsorship",
            "Different external sender domain. This is a partner webinar pitch, not the Aurora Retail launch pack.",
            full_date="2025年6月19日周四 08:59",
            category="promotions",
        ),
        message(
            "decoy-003-vendor-news",
            "Vendor News",
            "digest@vendor-news.test",
            "Weekly dock accessory supplier digest",
            "Includes a generic article about FCC labels and logistics, but no Aurora ALP-26 action.",
            full_date="2025年6月19日周四 09:30",
            category="promotions",
        ),
        message(
            "decoy-004-ap-old",
            "AP Bot",
            "ap-bot@auroraretail.test",
            "Paid invoice AP-717 receipt",
            "AP-717 was paid last month. It is not AP-771 and has no ALP-26 hold.",
            date="6月12日",
            full_date="2025年6月12日周四 17:20",
            unread=False,
        ),
    ]

    noise = [
        ("noise-001", "Google", "no-reply@google.test", "Security alert", "A new sign-in was detected for this mock account."),
        ("noise-002", "PayPal", "service@paypal.test", "Your verification code", "Use 472901 as a mock verification code."),
        ("noise-003", "Travel Desk", "travel@auroraretail.test", "July travel policy update", "Updated hotel cap for July supplier trips."),
        ("noise-004", "Recruiting", "recruiting@auroraretail.test", "Interview panel reminder", "Candidate panel shifted by 30 minutes."),
        ("noise-005", "Analytics Digest", "analytics@auroraretail.test", "Cart conversion dashboard", "Dashboard refresh succeeded."),
        ("noise-006", "Facilities", "facilities@auroraretail.test", "Office AC service", "Maintenance window after 18:30."),
        ("noise-007", "Legal Ops", "legal.ops@auroraretail.test", "Template archive moved", "Contract templates moved to the legal drive."),
        ("noise-008", "Social Monitor", "social@auroraretail.test", "Forum mentions", "No material ALP-26 launch action in this digest."),
        ("noise-009", "Promo Calendar", "promo@auroraretail.test", "Back-to-school promo slot", "Promo planning for August."),
        ("noise-010", "Supplier Portal", "portal@northport-3pl.test", "Password rotation notice", "Rotate portal credentials this week."),
        ("noise-011", "Design System", "design@auroraretail.test", "Icon library update", "New icon set published."),
        ("noise-012", "Community", "community@auroraretail.test", "Creator meetup", "Creator event reminder."),
        ("noise-013", "Training", "training@auroraretail.test", "Excel class", "Optional training invitation."),
        ("noise-014", "Benefits", "benefits@auroraretail.test", "Enrollment reminder", "Benefits enrollment closes soon."),
        ("noise-015", "Ops Bot", "ops-bot@auroraretail.test", "Nightly checks passed", "All non-launch checks green."),
    ]
    for idx, sender, email, subject, body in noise:
        messages.append(
            message(idx, sender, email, subject, body, full_date="2025年6月19日周四 12:00", unread=idx.endswith(("1", "5", "9")))
        )

    contacts = [
        {"id": "contact-alice", "name": "Alice Li", "email": "alice.li@auroraretail.test", "phone": "", "notes": "Launch owner", "source": "directory", "color": "#1a73e8"},
        {"id": "contact-mei", "name": "Mei Chen", "email": "mei.chen@lumenlabs.test", "phone": "", "notes": "Compliance lab", "source": "recent", "color": "#d93025"},
        {"id": "contact-leon", "name": "Leon Wu", "email": "leon.wu@northport-3pl.test", "phone": "", "notes": "3PL dock lead", "source": "recent", "color": "#188038"},
        {"id": "contact-nora", "name": "Nora Patel", "email": "nora.patel@auroraretail.test", "phone": "", "notes": "Creative lead", "source": "directory", "color": "#a142f4"},
        {"id": "contact-ap", "name": "AP Hold Queue", "email": "ap-hold@auroraretail.test", "phone": "", "notes": "Finance holds", "source": "directory", "color": "#f9ab00"},
        {"id": "contact-support", "name": "VIP Support", "email": "vip-support@auroraretail.test", "phone": "", "notes": "Support queue", "source": "directory", "color": "#188038"},
        {"id": "contact-ops", "name": "Ops Launch", "email": "ops-launch@auroraretail.test", "phone": "", "notes": "Launch distribution", "source": "directory", "color": "#1a73e8"},
    ]

    account = {
        "email": "ops.coordinator@auroraretail.test",
        "displayName": "Ops Coordinator",
        "storageLabel": "11.8 GB of 15 GB used",
        "lastActivity": "Last account activity: 3 minutes ago",
    }
    settings = {
        "density": "comfortable",
        "readingPane": "right",
        "conversationView": True,
        "smartCompose": True,
        "labelListExpanded": True,
        "expandedUserLabels": ["label-launch"],
    }
    meta = {
        "counterOffsets": {"labels": {}, "categories": {}},
        "nextLabelId": 1,
    }
    calendar_events = [
        {
            "id": "cal-existing-ops",
            "title": "Daily ops check",
            "date": "2025-06-19",
            "start": "09:00",
            "end": "09:30",
            "guests": "ops-launch@auroraretail.test",
            "location": "Ops room",
            "description": "Existing event; do not delete.",
            "meet": False,
            "allDay": False,
            "color": "#188038",
        }
    ]

    expected = {
        "task_id": "browser-gmail-launch-triage",
        "label": {"name": "ALP-26", "parent_name": "Launch"},
        "label_required_message_ids": [
            "alp-001-brief",
            "alp-002-fcc",
            "alp-003-logistics-final",
            "alp-005-finance",
            "alp-006-creative",
            "alp-007-support",
            "alp-008-sku",
            "alp-009-msds",
            "alp-010-exec-hold",
        ],
        "label_forbidden_message_ids": [
            "alp-004-logistics-stale",
            "decoy-001-alp25",
            "decoy-002-near-sender",
            "decoy-003-vendor-news",
            "decoy-004-ap-old",
        ],
        "mark_read_message_ids": [
            "alp-001-brief",
            "alp-002-fcc",
            "alp-003-logistics-final",
            "alp-005-finance",
            "alp-006-creative",
            "alp-007-support",
            "alp-008-sku",
            "alp-009-msds",
            "alp-010-exec-hold",
        ],
        "star_required_message_ids": [
            "alp-002-fcc",
            "alp-003-logistics-final",
            "alp-005-finance",
            "alp-009-msds",
        ],
        "star_forbidden_message_ids": [
            "alp-004-logistics-stale",
            "decoy-001-alp25",
            "decoy-002-near-sender",
            "decoy-003-vendor-news",
        ],
        "drafts": [
            {
                "id": "compliance",
                "to": ["mei.chen@lumenlabs.test"],
                "cc_any": ["alice.li@auroraretail.test", "ops-launch@auroraretail.test"],
                "subject_all": ["ALP-26", "FCC"],
                "body_all": ["W2K-4529", "Nova Home LLC", "Aurora Retail Ltd", "18:00 HKT"],
            },
            {
                "id": "logistics",
                "to": ["leon.wu@northport-3pl.test"],
                "cc_any": ["ops-launch@auroraretail.test"],
                "subject_all": ["ALP-26", "pickup"],
                "body_all": ["118 cartons", "WH-3", "14:30-16:00 HKT", "ALP26-DCK-118"],
            },
            {
                "id": "creative",
                "to": ["nora.patel@auroraretail.test"],
                "cc_any": [],
                "subject_all": ["ALP-26", "PDP"],
                "body_all": ["ALP26_Hero_v7.jpg", "ALP26_certified_claims.png", "medical-grade", "remove"],
            },
            {
                "id": "finance",
                "to": ["ap-hold@auroraretail.test"],
                "cc_any": ["priya.raman@auroraretail.test", "ops-launch@auroraretail.test"],
                "subject_all": ["AP-771", "hold"],
                "body_all": ["18,420", "PO line 4", "recycled insert", "W2K-4529"],
            },
            {
                "id": "support",
                "to": ["vip-support@auroraretail.test"],
                "cc_any": [],
                "subject_all": ["ALP-26", "VIP"],
                "body_all": ["37", "June 23", "opt-out", "MSDS"],
            },
        ],
        "tasks": [
            {
                "title_all": ["FCC", "W2K-4529"],
                "details_all": ["Mei", "18:00 HKT", "Aurora Retail"],
                "due_any": ["今天", "today", "2025-06-19"],
            },
            {
                "title_all": ["MSDS", "air"],
                "details_all": ["remove", "air-shipment-ready", "ALP-26"],
                "due_any": ["今天", "today", "2025-06-19"],
            },
        ],
        "calendar_event": {
            "title_all": ["ALP-26", "blocker"],
            "date": "2025-06-19",
            "start": "16:00",
            "end": "17:00",
            "guests_all": ["alice.li@auroraretail.test", "mei.chen@lumenlabs.test", "leon.wu@northport-3pl.test", "nora.patel@auroraretail.test"],
            "description_all": ["FCC", "118 cartons", "MSDS", "AP-771"],
        },
    }

    dump(SEEDS / "account.json", account)
    dump(SEEDS / "calendar_events.json", calendar_events)
    dump(SEEDS / "categories.json", categories)
    dump(SEEDS / "contacts.json", contacts)
    dump(SEEDS / "drafts.json", [])
    dump(SEEDS / "filters.json", [])
    dump(SEEDS / "labels.json", labels)
    dump(SEEDS / "messages.json", messages)
    dump(SEEDS / "meta.json", meta)
    dump(SEEDS / "notes.json", [])
    dump(SEEDS / "settings.json", settings)
    dump(SEEDS / "subscriptions.json", [])
    dump(SEEDS / "tasks.json", [])
    dump(PRIVATE / "expected_answer.json", expected)


if __name__ == "__main__":
    main()
