"""Casino page-chat verb allowlist and JSON contracts (v1).

Ollama (later) maps utterances → {verb, args}. Scripts return these shapes.
"""

from __future__ import annotations

from typing import Any, Literal

PAGE_CASINOS = "casinos"

# Verbs allowed on the Casinos Ask AI surface (server-enforced).
CASINO_VERBS: frozenset[str] = frozenset(
    {
        "get_casino",
        "project_status",
        "project_breakdown",
        "performance_index",
        "explain_topic",
    }
)

EXPLAIN_TOPICS: frozenset[str] = frozenset(
    {
        "project_completed",
        "report_received",
        "performance_index",
        "project_breakdown",
    }
)

# Human labels for clarify options (Ollama / stub).
CLARIFY_LANES: list[dict[str, str]] = [
    {
        "id": "project_status",
        "label": "Project / FSR work (completed or open)",
    },
    {
        "id": "performance_index",
        "label": "Performance / participation report for a month (processed in SQL or not)",
    },
]


CONTRACTS: dict[str, dict[str, Any]] = {
    "get_casino": {
        "args": {
            "casino_id": "CT-* (clients.casinos.reference_key)",
        },
        "result": {
            "casino_id": "CT-00003",
            "casino_name": "Lonestar Casino",
            "casino_short": "Lonestar",
            "tribe_name": "…",
            "state": "Oklahoma",
            "sales": "…",
            "emaint_property": "…",
            "address": "…",
            "city": "…",
        },
        "omits": ["coin", "win", "commission", "performance averages"],
        "notes": "Profile / hub identity only — no Master_Revenue money fields.",
    },
    "project_status": {
        "args": {
            "casino_id": "CT-*",
            "project_ref": "optional IMS-##### or PC-##### or project number string",
            "status_filter": "optional: open | completed | all (default all, recent first)",
            "limit": "default 10, max 25",
        },
        "result": {
            "casino_id": "CT-…",
            "projects": [
                {
                    "project_id": "PC-00330",
                    "project_number": "2952",
                    "project_name": "Havasu Landing …",
                    "ims_id": "IMS-00121",
                    "status": "COMPLETED",
                    "date_start": "2026-09-18",
                    "date_end": "2026-09-18",
                    "offer_breakdown": True,
                }
            ],
            "follow_up_prompt": "Want a breakdown of what was done?",
        },
        "notes": "Casino-scoped only. offer_breakdown when status looks completed.",
    },
    "project_breakdown": {
        "args": {
            "casino_id": "CT-* (must match project casino)",
            "project_id": "PC-* or catalog reference_key",
        },
        "result": {
            "project_id": "PC-00330",
            "project_number": "2952",
            "lines": [
                {
                    "vendor_name": "AGS",
                    "cabinet_type": "Orion Portrait",
                    "serial_number": "12345678",
                    "action": "CONVERT",
                    "theme_name": "Pillars of Cash",
                    "summary": "AGS · Orion Portrait · Serial 12345678 · Converted to Pillars of Cash",
                }
            ],
        },
        "omits": ["software", "program_storage", "settings", "money"],
        "notes": "From project_printout / details — stripped to identity + action + theme.",
    },
    "performance_index": {
        "args": {
            "casino_id": "CT-*",
            "month_end": "YYYY-MM-DD (month-end date)",
        },
        "result": {
            "casino_id": "CT-…",
            "casino_name": "…",
            "month_end": "2026-08-31",
            "processed": False,
            "mr_row_count": 0,
            "status": "not_received",
            "label": "August 2026 has not been processed (no Master_Revenue rows).",
        },
        "omits": ["coin_in", "actual_win", "commission", "dollar amounts"],
        "notes": "Processed in SQL = come in. Unprocessed ⇒ not received. No finance $.",
    },
    "explain_topic": {
        "args": {
            "topic_id": "project_completed | report_received | performance_index | project_breakdown"
        },
        "result": {"topic_id": "…", "text": "…"},
        "notes": "Curated short blurbs — not model invention.",
    },
}


EXPLAIN_TEXT: dict[str, str] = {
    "project_completed": (
        "A project is completed when its catalog/IMS status shows COMPLETED (or equivalent). "
        "That means the planned floor work for that job is closed — not that participation "
        "billing for the month is done."
    ),
    "report_received": (
        "For Ask AI, a performance month has 'come in' only after it is processed into "
        "SQL (Master_Revenue for that casino and month-end). Email or NAS alone does not count."
    ),
    "performance_index": (
        "Performance index answers whether we have processed participation for a casino-month. "
        "It does not show coin-in, win, or commission dollars. "
        "'Come in' here means processed into Master_Revenue — not that an email arrived."
    ),
    "project_breakdown": (
        "A project breakdown lists cabinets, serials, and what was done on that job "
        "(install, convert, remove, theme) from the project printout. "
        "It is not money, software settings, or a performance report."
    ),
}


def contracts_public() -> dict[str, Any]:
    return {
        "page": PAGE_CASINOS,
        "verbs": sorted(CASINO_VERBS),
        "clarify_lanes": CLARIFY_LANES,
        "contracts": CONTRACTS,
        "escalation": "Script → Ollama → Cursor (Cursor not wired in v1)",
        "session": "New session per Casinos / Casino Hub visit",
        "auth": "Signed-in user with Casinos browse (v1)",
        "ollama_model": "llama3.2:3b",
        "router": "stub keywords first; Ollama on clarify/unsupported NL",
    }
