"""Casino page-chat verb allowlist and JSON contracts.

Ollama maps utterances → {verb, args}. Scripts return these shapes.
Live verbs are enforced in runners; planned verbs are published for
router/UI design and are rejected until runners ship.
"""

from __future__ import annotations

from typing import Any

PAGE_CASINOS = "casinos"

# Verbs enforced on the Casinos Ask AI surface (server + runners).
CASINO_VERBS: frozenset[str] = frozenset(
    {
        "get_casino",
        "project_status",
        "project_breakdown",
        "performance_index",
        "explain_topic",
    }
)

# Specced 2026-09-21 — not in runners yet. Do not add to CASINO_VERBS until implemented.
CASINO_VERBS_PLANNED: frozenset[str] = frozenset(
    {
        "last_project",
        "scheduled_projects",
        "list_report_templates",
        "preview_report",
        "send_report",
    }
)

EXPLAIN_TOPICS: frozenset[str] = frozenset(
    {
        "project_completed",
        "report_received",
        "performance_index",
        "project_breakdown",
        "last_project",
        "scheduled_projects",
        "reports",
    }
)

# Human labels for clarify options shown in the UI (live verbs only).
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

# Specced lanes — publish for design; do not show until runners ship.
CLARIFY_LANES_PLANNED: list[dict[str, str]] = [
    {
        "id": "last_project",
        "label": "Most recent project (by start date) + optional breakdown",
    },
    {
        "id": "scheduled_projects",
        "label": "Upcoming / scheduled project work for this casino",
    },
    {
        "id": "preview_report",
        "label": "Generate / email a pre-built report (I'll ask for missing params)",
    },
]

# Registered report templates (pre-built). Expand as scripts/APIs land.
# status: ready = runner may generate; stub = contract only.
REPORT_TEMPLATES: dict[str, dict[str, Any]] = {
    "casino_ops_pack": {
        "status": "stub",
        "label": "Casino ops pack (internal email)",
        "description": (
            "One-page internal pack: identity, last project summary, "
            "upcoming schedule, performance month processed flag."
        ),
        "required_args": ["casino_id"],
        "optional_args": {
            "month_end": "YYYY-MM-DD — performance_index month (default: latest processed or prior month)",
            "include_breakdown": "bool — attach last-project line summary (default false)",
            "as_of": "YYYY-MM-DD — schedule/last-project reference day (default today)",
        },
        "send": {
            "channel": "resend",
            "from": "DGS Reporting <reporting@collinsmediallc.com>",
            "recipients": "self | employees.employee_roles directory email only",
            "confirm_required": True,
        },
        "omits": ["coin_in", "win", "commission", "software settings"],
    },
}


CONTRACTS: dict[str, dict[str, Any]] = {
    "get_casino": {
        "status": "live",
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
        "status": "live",
        "args": {
            "casino_id": "CT-*",
            "project_ref": "optional IMS-##### or PC-##### or project number string",
            "status_filter": "optional: open | completed | all (default all, recent first)",
            "limit": "default 10, max 25",
            "month_end": "optional YYYY-MM-DD — filter projects overlapping that calendar month",
        },
        "result": {
            "casino_id": "CT-…",
            "month_label": "August 2026",
            "projects": [
                {
                    "project_id": "PC-00330",
                    "project_number": "2952",
                    "project_name": "Havasu Landing …",
                    "ims_id": "IMS-00121",
                    "status": "COMPLETED",
                    "date_start": "2026-08-01",
                    "date_end": "2026-08-03",
                    "offer_breakdown": True,
                }
            ],
            "follow_up_prompt": "Want a breakdown of what was done?",
        },
        "notes": "Casino-scoped list. Prefer last_project when user asks for 'the last project'.",
    },
    "last_project": {
        "status": "planned",
        "args": {
            "casino_id": "CT-*",
            "as_of": "optional YYYY-MM-DD (default today) — ranking / overlap reference day",
            "include_breakdown": "optional bool (default false) — if true and unique, chain project_breakdown",
        },
        "result_unique": {
            "kind": "result",
            "verb": "last_project",
            "casino_id": "CT-…",
            "selection": "unique",
            "project": {
                "project_id": "PC-00330",
                "project_number": "2952",
                "project_name": "…",
                "ims_id": "IMS-00121",
                "status": "COMPLETED",
                "date_start": "2026-08-01",
                "date_end": "2026-08-03",
                "offer_breakdown": True,
            },
            "breakdown": "null | project_breakdown.result when include_breakdown",
            "follow_up_prompt": "Want a breakdown of what was done?",
        },
        "result_overlap": {
            "kind": "clarify",
            "reply": "Two projects overlap on start dates — which one?",
            "options": [
                {
                    "id": "PC-00330",
                    "label": "2952 · Havasu … · start 2026-08-01",
                    "verb": "last_project",
                    "args": {"casino_id": "CT-…", "project_ref": "PC-00330"},
                }
            ],
        },
        "rules": [
            "Source: projects.project_catalog for that casino_id (same as project_status).",
            "Primary pick: newest by date_start DESC (null start excluded).",
            "Concurrent / overlap: any other catalog row whose "
            "[date_start, COALESCE(date_end, date_start)] overlaps the winner's span "
            "→ do not auto-pick; return clarify options (max ~5), sorted by date_start DESC.",
            "Explicit project_ref in args (after clarify) → resolve that project only "
            "(still casino-scoped); skip overlap logic.",
            "Usual case: one winner → result_unique + offer_breakdown chip.",
        ],
        "omits": ["software", "settings", "money"],
        "notes": (
            "Not a silent TOP 3 list. User asked for 'the last project' — one answer, "
            "or a short clarify list when two are happening at once."
        ),
    },
    "scheduled_projects": {
        "status": "planned",
        "args": {
            "casino_id": "CT-*",
            "from_date": "optional YYYY-MM-DD (default today)",
            "to_date": "optional YYYY-MM-DD (default from_date + 90 days)",
            "limit": "default 10, max 25",
        },
        "result": {
            "verb": "scheduled_projects",
            "casino_id": "CT-…",
            "from_date": "2026-09-21",
            "to_date": "2026-12-20",
            "projects": [
                {
                    "ims_id": "IMS-00130",
                    "project_number": "3010",
                    "project_name": "…",
                    "catalog_id": "PC-00340",
                    "status": "OPEN",
                    "date_start": "2026-10-05",
                    "date_end": "2026-10-07",
                    "lead_tech": "…",
                }
            ],
            "total": 1,
            "empty_label": "No projects scheduled for this casino in that window.",
        },
        "rules": [
            "Source of truth: projects.ims (calendar SSOT), casino_id scoped.",
            "Include rows where start_date >= from_date AND start_date <= to_date.",
            "Join matching_catalog when ims_id links (catalog_id / project_name enrich).",
            "Order by start_date ASC (soonest first).",
            "Empty is a valid result — not unsupported.",
        ],
        "notes": "Answers 'is anything scheduled?' without opening Projects calendar.",
    },
    "project_breakdown": {
        "status": "live",
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
        "status": "live",
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
    "list_report_templates": {
        "status": "planned",
        "args": {},
        "result": {
            "verb": "list_report_templates",
            "templates": [
                {
                    "report_type": "casino_ops_pack",
                    "status": "stub",
                    "label": "Casino ops pack (internal email)",
                    "required_args": ["casino_id"],
                    "optional_args": ["month_end", "include_breakdown", "as_of"],
                }
            ],
        },
        "notes": "Ollama/user discovery of what can be generated. No generation.",
    },
    "preview_report": {
        "status": "planned",
        "args": {
            "report_type": "enum from REPORT_TEMPLATES keys",
            "casino_id": "CT-* when template requires it",
            "month_end": "optional per template",
            "include_breakdown": "optional bool",
            "as_of": "optional YYYY-MM-DD",
            # Template-specific extras allowed only if listed on that template.
        },
        "result": {
            "verb": "preview_report",
            "report_type": "casino_ops_pack",
            "preview_id": "prv_…",
            "summary": "Short human summary of what will be sent",
            "params_resolved": {"casino_id": "CT-…", "month_end": "2026-08-31"},
            "missing_params": [],
            "sections": ["identity", "last_project", "scheduled", "performance_index"],
            "confirm_prompt": "Send this to you, or pick someone from the directory?",
        },
        "result_need_params": {
            "kind": "clarify",
            "reply": "Which month should the performance section use?",
            "missing_params": ["month_end"],
            "options": None,
        },
        "rules": [
            "Templates are pre-built; Ollama only fills args from utterance + page focus.",
            "If required/optional-but-ambiguous params missing → clarify (ask the user), "
            "do not invent. Users may supply several params in one utterance — accept all known keys.",
            "Unknown report_type → unsupported (and unmet log) or list_report_templates suggest.",
            "status=stub templates → reply that template is not ready yet (still log interest).",
            "No send in this verb — preview only. preview_id is short-lived (session-scoped).",
        ],
        "notes": "Generate side. Send is a separate gated verb.",
    },
    "send_report": {
        "status": "planned",
        "args": {
            "preview_id": "from preview_report (preferred)",
            "report_type": "required if no preview_id — must re-resolve params",
            "casino_id": "CT-* when required",
            "recipient": "self | EMP-* | directory email (active employee_roles only)",
            "confirm": "must be true — silent send forbidden",
        },
        "result": {
            "verb": "send_report",
            "sent": True,
            "channel": "resend",
            "to": ["mark@…"],
            "cc": ["requester@…"],
            "subject": "…",
            "preview_id": "prv_…",
        },
        "rules": [
            "confirm != true → clarify 'Send now?' chip — never auto-send.",
            "Recipients: signed-in user (self) or active employees.employee_roles email only "
            "(same spirit as warehouse export). No freeform external addresses in v1.",
            "Prefer preview_id so params are frozen; if only report_type, run preview path first.",
            "External manufacturer / accounting Gmail drafts = later templates + draft-only channel.",
        ],
        "omits": ["arbitrary SMTP", "Gmail send-as Paul"],
        "notes": "Gated write. Server enforces directory + confirm.",
    },
    "explain_topic": {
        "status": "live",
        "args": {
            "topic_id": (
                "project_completed | report_received | performance_index | "
                "project_breakdown | last_project | scheduled_projects | reports"
            )
        },
        "result": {"topic_id": "…", "text": "…"},
        "notes": "Curated short blurbs — not model invention.",
    },
}


# Side-effect contract (not a user verb): unmet / unsupported asks → durable log.
UNMET_REQUEST_LOG: dict[str, Any] = {
    "status": "planned",
    "trigger": (
        "kind=unsupported after stub+Ollama, or planned verb with status=stub, "
        "or report_type not in REPORT_TEMPLATES"
    ),
    "fields": {
        "id": "uuid",
        "created_at": "ISO-8601 UTC",
        "user_email": "from session auth",
        "user_emp_id": "EMP-* when known",
        "page": "casinos",
        "session_id": "…",
        "casino_id": "CT-* or null",
        "casino_name": "string or null",
        "utterance": "raw user text (trim, max ~2k)",
        "router": "stub | ollama | explicit_json",
        "outcome": "unsupported | stub_template | unknown_report_type | clarify_exhausted",
        "suggested_verb": "optional guess string — not executed",
    },
    "store": "SQL table preferred (e.g. app.page_chat_unmet_requests) — not container logs only",
    "notes": (
        "Feeds future verb development. Do not block the user reply on log failure; "
        "best-effort insert after composing unsupported reply."
    ),
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
    "last_project": (
        "Last project means the most recent job for that casino by start date. "
        "If two projects overlap in time, Ask AI will list them and ask which one you mean "
        "instead of guessing."
    ),
    "scheduled_projects": (
        "Scheduled projects are upcoming IMS calendar jobs for that casino "
        "(start date in the asked window). Empty means nothing on the calendar — "
        "not that the casino has no history."
    ),
    "reports": (
        "Ask AI can only generate pre-built report templates. It will ask for any missing "
        "parameters (casino, month, recipient). Preview first; send only after you confirm. "
        "Internal email uses the employee directory — not freeform outside addresses."
    ),
}


def contracts_public() -> dict[str, Any]:
    return {
        "page": PAGE_CASINOS,
        "verbs": sorted(CASINO_VERBS),
        "verbs_planned": sorted(CASINO_VERBS_PLANNED),
        "clarify_lanes": CLARIFY_LANES,
        "clarify_lanes_planned": CLARIFY_LANES_PLANNED,
        "report_templates": REPORT_TEMPLATES,
        "contracts": CONTRACTS,
        "unmet_request_log": UNMET_REQUEST_LOG,
        "escalation": "Script → Ollama → Cursor (Cursor not wired)",
        "session": "New session per Casinos / Casino Hub visit",
        "auth": "Signed-in user with Casinos browse (v1)",
        "ollama_model": "llama3.2:3b",
        "router": "stub keywords first; Ollama on clarify/unsupported NL",
    }
