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
        "options": None,
        "follow_up_prompt": data.get("follow_up_prompt"),
        "router": router_source,
    }
    sessions.append_exchange(
        session_id,
        text,
        {k: out[k] for k in ("kind", "reply", "verb", "follow_up_prompt", "router")},
    )
    return out


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
    # Prefer a named property in the utterance over the page selection.
    casino_id, meta = resolve.resolve_casino_id(text=text, args={}, session=session)
    if meta.get("ambiguous"):
        names = [
            m.get("casino_short") or m.get("casino_name") or m.get("casino_id")
            for m in meta["ambiguous"]
        ]
        return {
            "kind": "clarify",
            "reply": "Which casino did you mean: " + ", ".join(names) + "?",
            "options": None,
        }

    # Affirmative after status → breakdown of first completed project in last result is hard
    # without state; accept "breakdown" / "yes" with project_id in session messages later.
    if low in {"yes", "y", "yeah", "sure", "please"} or "breakdown" in low:
        # Try to find a PC-/IMS- token in the message
        m = re.search(r"\b(PC-\d+|IMS-\d+)\b", text, re.I)
        if m and casino_id:
            return {
                "kind": "run",
                "verb": "project_breakdown",
                "args": {"casino_id": casino_id, "project_id": m.group(1)},
            }
        if casino_id and "breakdown" in low:
            return {
                "kind": "clarify",
                "reply": (
                    "Which project should I break down? Reply with the project id "
                    "(PC-#####) or ask about project status first."
                ),
                "options": CLARIFY_LANES,
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
