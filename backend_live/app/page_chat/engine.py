"""Page-chat turn engine — Script stub → Ollama escalate (no Cursor in v1)."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException

from app.page_chat import ollama, resolve, runners, sessions
from app.page_chat.contracts import CASINO_VERBS, CLARIFY_LANES, PAGE_CASINOS


def process_message(session_id: str, content: str, *, user: dict[str, Any] | None) -> dict[str, Any]:
    rec = sessions.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if rec.get("page") != PAGE_CASINOS:
        raise HTTPException(status_code=400, detail="Only casinos page is supported in v1")

    text = (content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="content is required")

    routed, router_source = _route(text, session=rec)
    if routed.get("kind") == "clarify":
        out = {
            "kind": "clarify",
            "reply": routed["reply"],
            "options": routed["options"],
            "verb": None,
            "data": None,
            "router": router_source,
        }
        sessions.append_exchange(session_id, text, out)
        return out

    if routed.get("kind") == "unsupported":
        out = {
            "kind": "unsupported",
            "reply": routed["reply"],
            "options": None,
            "verb": None,
            "data": None,
            "router": router_source,
        }
        sessions.append_exchange(session_id, text, out)
        return out

    verb = routed["verb"]
    args = dict(routed.get("args") or {})
    if verb not in CASINO_VERBS:
        raise HTTPException(status_code=400, detail=f"verb not allowed: {verb}")

    if verb != "explain_topic":
        cid, meta = resolve.resolve_casino_id(text=text, args=args, session=rec)
        if meta.get("ambiguous"):
            names = [
                m.get("casino_short") or m.get("casino_name") or m.get("casino_id")
                for m in meta["ambiguous"]
            ]
            out = {
                "kind": "clarify",
                "reply": "Which casino did you mean: " + ", ".join(names) + "?",
                "options": None,
                "verb": None,
                "data": None,
                "router": router_source,
            }
            sessions.append_exchange(session_id, text, out)
            return out
        if not cid:
            out = {
                "kind": "unsupported",
                "reply": (
                    "Select a casino on this page, or name the property in your question "
                    "(e.g. Havasu Landing)."
                ),
                "options": None,
                "verb": None,
                "data": None,
                "router": router_source,
            }
            sessions.append_exchange(session_id, text, out)
            return out
        args["casino_id"] = cid
        session_cid = (rec.get("casino_id") or "").strip() or None
        cross = bool(session_cid and cid != session_cid)
        if cross and not (meta.get("casino_short") or meta.get("casino_name")):
            hit = next((c for c in resolve.casinos_catalog() if c["casino_id"] == cid), None)
            if hit:
                meta["casino_short"] = hit.get("casino_short")
                meta["casino_name"] = hit.get("casino_name")
        cross_label = meta.get("casino_short") or meta.get("casino_name")
    else:
        cross = False
        cross_label = None

    try:
        data = runners.run(verb, args, session=rec)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"runner error: {exc}") from exc

    reply = _format_reply(verb, data, cross_label=cross_label if cross else None)
    out = {
        "kind": "result",
        "reply": reply,
        "verb": verb,
        "args": args,
        "data": data,
        "options": _result_options(verb, data),
        "follow_up_prompt": data.get("follow_up_prompt"),
        "router": router_source,
    }
    focus = _focus_from_result(verb, args, data, cross_label=cross_label if cross else None)
    sessions.append_exchange(
        session_id,
        text,
        {k: out[k] for k in ("kind", "reply", "verb", "follow_up_prompt", "router")},
        focus=focus,
    )
    return out


def _focus_from_result(
    verb: str,
    args: dict[str, Any],
    data: dict[str, Any],
    *,
    cross_label: str | None,
) -> dict[str, Any] | None:
    if verb == "project_status":
        projects = data.get("projects") or []
        return {
            "verb": "project_status",
            "casino_id": data.get("casino_id") or args.get("casino_id"),
            "casino_short": cross_label,
            "casino_name": data.get("casino_name") or cross_label,
            "projects": [
                {
                    "project_id": p.get("project_id"),
                    "project_number": p.get("project_number"),
                    "status": p.get("status"),
                    "offer_breakdown": bool(p.get("offer_breakdown")),
                }
                for p in projects[:10]
            ],
            "awaiting_breakdown": bool(data.get("follow_up_prompt")),
        }
    if verb == "project_breakdown":
        return {
            "verb": "project_breakdown",
            "casino_id": data.get("casino_id") or args.get("casino_id"),
            "casino_short": cross_label,
            "casino_name": data.get("casino_name") or cross_label,
            "projects": [
                {
                    "project_id": data.get("project_id"),
                    "project_number": data.get("project_number"),
                    "offer_breakdown": False,
                }
            ],
            "awaiting_breakdown": False,
        }
    if verb in {"get_casino", "performance_index"}:
        return {
            "verb": verb,
            "casino_id": data.get("casino_id") or args.get("casino_id"),
            "casino_short": cross_label or data.get("casino_short"),
            "casino_name": data.get("casino_name") or cross_label,
            "projects": [],
            "awaiting_breakdown": False,
        }
    return None


def _result_options(verb: str, data: dict[str, Any]) -> list[dict[str, str]] | None:
    if verb != "project_status":
        return None
    projects = data.get("projects") or []
    if not projects:
        return None
    opts = []
    for p in projects[:5]:
        num = p.get("project_number") or p.get("project_id")
        if not num:
            continue
        label = f"{num}: {p.get('status') or 'status?'}"
        opts.append({"id": f"breakdown:{num}", "label": f"Breakdown {num}"})
    return opts or None


def _route(text: str, *, session: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Script-first; escalate ambiguous stub outcomes to Ollama."""
    stub = _stub_route(text, session=session)
    if stub.get("kind") == "run":
        return stub, "stub"
    # Explicit JSON already handled inside stub; only escalate clarify/unsupported NL.
    if text.startswith("{") and text.endswith("}"):
        return stub, "stub"
    escalated = ollama.route(text, session=session)
    if escalated:
        return escalated, "ollama"
    return stub, "stub"


def _stub_route(text: str, *, session: dict[str, Any]) -> dict[str, Any]:
    """Deterministic keywords + explicit verb JSON."""
    # Explicit machine path for tests / power users
    if text.startswith("{") and text.endswith("}"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and payload.get("verb"):
            verb = str(payload["verb"]).strip()
            args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
            return {"kind": "run", "verb": verb, "args": args}

    low = text.lower().strip()
    focus = session.get("last_focus") if isinstance(session.get("last_focus"), dict) else {}
    focus_projects = focus.get("projects") or []

    # Chip / lane shortcuts (UI sends these labels).
    if low in {
        "project / fsr status",
        "project / fsr work (completed or open)",
        "project status",
    }:
        casino_id, meta = resolve.resolve_casino_id(text=text, args={}, session=session)
        if meta.get("ambiguous"):
            return _ambiguous_clarify(meta)
        if not casino_id:
            return {
                "kind": "unsupported",
                "reply": "Select a casino, or name the property in your question.",
            }
        return {"kind": "run", "verb": "project_status", "args": {"casino_id": casino_id}}

    if low.startswith("did this month") or low.startswith("performance / participation"):
        casino_id, meta = resolve.resolve_casino_id(text=text, args={}, session=session)
        if not casino_id:
            return {
                "kind": "unsupported",
                "reply": "Select a casino first, then ask about a month.",
            }
        return {
            "kind": "clarify",
            "reply": (
                "Which month-end should I check (YYYY-MM-DD)? "
                "Example: 2026-08-31 for August 2026."
            ),
            "options": None,
        }

    # Definitions — never send these to the project stub / Ollama.
    if _is_explain_ask(low):
        topic = _guess_explain_topic(low)
        if topic:
            return {"kind": "run", "verb": "explain_topic", "args": {"topic_id": topic}}

    # Prefer a named property in the utterance over the page selection / sticky focus.
    casino_id, meta = resolve.resolve_casino_id(text=text, args={}, session=session)
    if meta.get("ambiguous"):
        return _ambiguous_clarify(meta)

    # "Most recent / latest" after a project list.
    if any(
        p in low
        for p in (
            "most recent",
            "latest",
            "newest",
            "which is the most",
            "which one is most",
            "which project is most",
        )
    ):
        if focus_projects and focus.get("casino_id"):
            top = focus_projects[0]
            ref = top.get("project_number") or top.get("project_id")
            return {
                "kind": "run",
                "verb": "project_status",
                "args": {
                    "casino_id": focus["casino_id"],
                    "project_ref": str(ref),
                    "limit": 1,
                },
            }
        return {
            "kind": "clarify",
            "reply": "Ask about project status first, then I can tell you which is most recent.",
            "options": CLARIFY_LANES,
        }

    # Affirmative / breakdown follow-ups — use sticky focus + bare project numbers.
    yes = low in {"yes", "y", "yeah", "sure", "please", "ok", "okay", "yep"}
    wants_breakdown = yes or "breakdown" in low or low.startswith("break down")
    if wants_breakdown:
        ref = _project_ref_from_text(text, focus_projects)
        if ref and (casino_id or focus.get("casino_id")):
            return {
                "kind": "run",
                "verb": "project_breakdown",
                "args": {
                    "casino_id": casino_id or focus.get("casino_id"),
                    "project_id": ref,
                },
            }
        if yes and focus.get("awaiting_breakdown") and focus_projects:
            pick = next(
                (p for p in focus_projects if p.get("offer_breakdown")),
                focus_projects[0],
            )
            ref = pick.get("project_id") or pick.get("project_number")
            if ref and focus.get("casino_id"):
                return {
                    "kind": "run",
                    "verb": "project_breakdown",
                    "args": {
                        "casino_id": focus["casino_id"],
                        "project_id": str(ref),
                    },
                }
        if "breakdown" in low or "break down" in low:
            opts = _result_options("project_status", {"projects": focus_projects}) if focus_projects else None
            return {
                "kind": "clarify",
                "reply": (
                    "Which project should I break down? Reply with the project number "
                    "(e.g. 2952) or tap one below."
                    if opts
                    else "Which project should I break down? Reply with the project number "
                    "(e.g. 2952) or ask about project status first."
                ),
                "options": opts or CLARIFY_LANES,
            }

    if any(
        w in low
        for w in (
            "who is",
            "tell me about",
            "profile",
            "what's on this casino",
            "whats on this casino",
            "general manager",
            " gm ",
            "tribe",
            "address",
            "where is",
        )
    ):
        if not casino_id:
            return {
                "kind": "unsupported",
                "reply": "Select a casino (or Casino Hub) so I know which property you mean.",
            }
        return {"kind": "run", "verb": "get_casino", "args": {"casino_id": casino_id}}

    if any(
        w in low
        for w in (
            "project",
            "fsr",
            "completed",
            "complete",
            "finished",
            "uploaded",
            "upload",
            "ims-",
            "pc-",
            "floor work",
            "floorjob",
            "floor job",
            "jobs",
            "install",
            "conversion",
        )
    ):
        if not casino_id:
            return {
                "kind": "unsupported",
                "reply": (
                    "Select a casino first, or name the property "
                    "(e.g. “Havasu Landing project”)."
                ),
            }
        args: dict[str, Any] = {"casino_id": casino_id}
        m = re.search(r"\b(PC-\d+|IMS-\d+|\d{3,5})\b", text, re.I)
        if m:
            args["project_ref"] = m.group(1)
        if any(w in low for w in ("complete", "completed", "finished", "done")):
            args["status_filter"] = "completed"
        return {"kind": "run", "verb": "project_status", "args": args}

    if any(
        w in low
        for w in (
            "come in",
            "came in",
            "received",
            "performance",
            "participation",
            "report",
            "august",
            "july",
            "june",
            "september",
            "processed",
        )
    ):
        if not casino_id:
            return {
                "kind": "unsupported",
                "reply": "Select a casino first, then ask if a month has come in / been processed.",
            }
        month_end = _guess_month_end(low)
        if not month_end:
            return {
                "kind": "clarify",
                "reply": (
                    "Which month-end should I check (YYYY-MM-DD)? "
                    "Example: 2026-08-31 for August 2026."
                ),
                "options": CLARIFY_LANES,
            }
        # Ambiguous "come in" without project/performance cue → still prefer performance if month present
        if "project" in low or "fsr" in low:
            return {
                "kind": "clarify",
                "reply": (
                    "By 'come in', did you mean a **project / FSR** or the "
                    f"**performance report for {month_end}**?"
                ),
                "options": CLARIFY_LANES,
            }
        return {
            "kind": "run",
            "verb": "performance_index",
            "args": {"casino_id": casino_id, "month_end": month_end},
        }

    if "come in" in low or "came in" in low:
        return {
            "kind": "clarify",
            "reply": (
                "By 'come in', did you mean **[project / FSR work]** or "
                "**[performance / participation report for a month]**?"
            ),
            "options": CLARIFY_LANES,
        }

    return {
        "kind": "clarify",
        "reply": (
            "I can help with a casino's **profile**, **project status** "
            "(and a serial/theme breakdown), or whether a month's performance "
            "has been **processed**. Name the property if it isn't the one selected. "
            "Which do you want?"
        ),
        "options": CLARIFY_LANES,
    }


def _ambiguous_clarify(meta: dict[str, Any]) -> dict[str, Any]:
    names = [
        m.get("casino_short") or m.get("casino_name") or m.get("casino_id")
        for m in meta.get("ambiguous") or []
    ]
    return {
        "kind": "clarify",
        "reply": "Which casino did you mean: " + ", ".join(names) + "?",
        "options": None,
    }


def _is_explain_ask(low: str) -> bool:
    return any(
        p in low
        for p in (
            "what does",
            "what is",
            "what's",
            "whats",
            "mean in",
            "meaning of",
            "explain",
        )
    )


def _guess_explain_topic(low: str) -> str | None:
    if "breakdown" in low:
        return "project_breakdown"
    if "come in" in low or "came in" in low or "received" in low:
        return "report_received"
    if "performance" in low or "participation" in low or "index" in low:
        return "performance_index"
    if "completed" in low or "complete" in low:
        return "project_completed"
    return None


def _project_ref_from_text(text: str, focus_projects: list[dict[str, Any]]) -> str | None:
    m = re.search(r"\b(PC-\d+|IMS-\d+)\b", text, re.I)
    if m:
        return m.group(1)
    m = re.search(r"\b(\d{3,5})\b", text)
    if not m:
        return None
    num = m.group(1)
    # Prefer matching a project from the last list.
    for p in focus_projects:
        if str(p.get("project_number") or "") == num:
            return str(p.get("project_id") or num)
        if str(p.get("project_id") or "").endswith(num):
            return str(p.get("project_id"))
    return num


def _guess_month_end(low: str) -> str | None:
    # Explicit ISO
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", low)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    months = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "sept": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }
    year_m = re.search(r"\b(20\d{2})\b", low)
    year = int(year_m.group(1)) if year_m else None
    for name, num in months.items():
        if re.search(rf"\b{name}\b", low):
            if year is None:
                # default current-ish — prefer requiring year in clarify; use 2026 as pilot default
                year = 2026
            # month-end day
            import calendar

            last = calendar.monthrange(year, num)[1]
            return f"{year:04d}-{num:02d}-{last:02d}"
    return None


def _format_reply(
    verb: str,
    data: dict[str, Any],
    *,
    cross_label: str | None = None,
) -> str:
    prefix = f"For {cross_label}: " if cross_label else ""
    if verb == "get_casino":
        return (
            f"{prefix}{data.get('casino_name')} ({data.get('casino_id')}) — "
            f"{data.get('tribe_name') or '—'}, {data.get('state') or '—'}."
        )
    if verb == "project_status":
        projects = data.get("projects") or []
        if not projects:
            return (
                f"{prefix}I don't see matching projects for this casino with that filter."
            )
        if len(projects) == 1:
            p = projects[0]
            reply = (
                f"{prefix}Most recent / match: "
                f"{p.get('project_number') or p.get('project_id')}: "
                f"{p.get('status') or 'unknown'} "
                f"({p.get('project_name') or '—'})."
            )
            if p.get("offer_breakdown") or data.get("follow_up_prompt"):
                reply += "\n\nWant a breakdown of what was done?"
            return reply
        bits = []
        for p in projects[:5]:
            bits.append(
                f"{p.get('project_number') or p.get('project_id')}: "
                f"{p.get('status') or 'unknown'} "
                f"({p.get('project_name') or '—'})"
            )
        reply = f"{prefix}Here's what I find:\n- " + "\n- ".join(bits)
        if data.get("follow_up_prompt"):
            reply += f"\n\n{data['follow_up_prompt']}"
        return reply
    if verb == "project_breakdown":
        lines = data.get("lines") or []
        if not lines:
            return (
                f"{prefix}Project {data.get('project_number') or data.get('project_id')} "
                "has no printout lines I can summarize."
            )
        body = "\n".join(f"- {ln.get('summary')}" for ln in lines[:40])
        more = "" if len(lines) <= 40 else f"\n…and {len(lines) - 40} more lines."
        return (
            f"{prefix}Breakdown for project "
            f"{data.get('project_number') or data.get('project_id')}:\n"
            f"{body}{more}"
        )
    if verb == "performance_index":
        label = str(data.get("label") or data.get("status"))
        return f"{prefix}{label}" if prefix else label
    if verb == "explain_topic":
        return str(data.get("text") or "")
    return "Done."
