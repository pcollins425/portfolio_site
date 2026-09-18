"""Tier-1 Casino runners — deterministic SQL/JSON, no LLM."""

from __future__ import annotations

from calendar import month_name
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from app.page_chat import db
from app.page_chat.contracts import EXPLAIN_TEXT, EXPLAIN_TOPICS


def run(verb: str, args: dict[str, Any], *, session: dict[str, Any]) -> dict[str, Any]:
    casino_id = (args.get("casino_id") or session.get("casino_id") or "").strip()
    if verb == "get_casino":
        return get_casino(casino_id)
    if verb == "project_status":
        return project_status(
            casino_id,
            project_ref=(args.get("project_ref") or "").strip() or None,
            status_filter=(args.get("status_filter") or "all").strip().lower(),
            limit=int(args.get("limit") or 10),
        )
    if verb == "project_breakdown":
        return project_breakdown(
            casino_id,
            project_id=(args.get("project_id") or args.get("project_ref") or "").strip(),
        )
    if verb == "performance_index":
        return performance_index(
            casino_id,
            month_end=_parse_month_end(args.get("month_end")),
        )
    if verb == "explain_topic":
        return explain_topic((args.get("topic_id") or "").strip())
    raise HTTPException(status_code=400, detail=f"unknown verb: {verb}")


def get_casino(casino_id: str) -> dict[str, Any]:
    cid = _require_casino(casino_id)
    rows = db.query(
        """
        SELECT
            c.reference_key,
            c.casino_name,
            c.casino_short,
            c.casino_abbreviation,
            t.tribe_name,
            s.state,
            s.state_abbreviation,
            c.sales,
            c.emaint_property,
            c.address,
            c.city,
            c.zip,
            c.general_manager_name,
            c.slot_director_name
        FROM clients.casinos AS c
        LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
        LEFT JOIN clients.states AS s ON s.reference_key = COALESCE(c.state_id, t.state_id)
        WHERE c.reference_key = %s
        """,
        (cid,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"casino not found: {cid}")
    r = rows[0]
    return {
        "verb": "get_casino",
        "casino_id": db.json_value(r.get("reference_key")),
        "casino_name": db.json_value(r.get("casino_name")),
        "casino_short": db.json_value(r.get("casino_short")),
        "casino_abbreviation": db.json_value(r.get("casino_abbreviation")),
        "tribe_name": db.json_value(r.get("tribe_name")),
        "state": db.json_value(r.get("state")),
        "state_abbreviation": db.json_value(r.get("state_abbreviation")),
        "sales": db.json_value(r.get("sales")),
        "emaint_property": db.json_value(r.get("emaint_property")),
        "address": db.json_value(r.get("address")),
        "city": db.json_value(r.get("city")),
        "zip": db.json_value(r.get("zip")),
        "general_manager_name": db.json_value(r.get("general_manager_name")),
        "slot_director_name": db.json_value(r.get("slot_director_name")),
    }


def project_status(
    casino_id: str,
    *,
    project_ref: str | None = None,
    status_filter: str = "all",
    limit: int = 10,
) -> dict[str, Any]:
    cid = _require_casino(casino_id)
    limit = max(1, min(limit, 25))
    params: list[Any] = [cid]
    extra = ""
    if project_ref:
        extra = """
          AND (
            pc.reference_key = %s
            OR pc.ims_id = %s
            OR pc.ims_project_number = %s
            OR CAST(pc.ims_project_number AS nvarchar(50)) = %s
          )
        """
        params.extend([project_ref, project_ref, project_ref, project_ref])

    rows = db.query(
        f"""
        SELECT TOP ({limit})
            pc.reference_key AS project_id,
            pc.ims_project_number AS project_number,
            pc.project_name,
            pc.ims_id,
            pc.ims_project_number,
            pc.casino_id,
            pc.status AS status_code,
            ps.status_name,
            pc.date_start,
            pc.date_end
        FROM projects.project_catalog AS pc
        LEFT JOIN projects.project_status AS ps ON ps.status_code = pc.status
        WHERE pc.casino_id = %s
        {extra}
        ORDER BY
            COALESCE(pc.date_end, pc.date_start, CAST('1900-01-01' AS date)) DESC,
            pc.reference_key DESC
        """,
        tuple(params),
    )

    projects = []
    for r in rows:
        status = (db.json_value(r.get("status_name")) or "").strip()
        status_u = status.upper()
        if status_filter == "completed" and "COMPLETE" not in status_u:
            continue
        if status_filter == "open" and "COMPLETE" in status_u:
            continue
        completed = "COMPLETE" in status_u
        projects.append(
            {
                "project_id": db.json_value(r.get("project_id")),
                "project_number": db.json_value(r.get("project_number")),
                "project_name": db.json_value(r.get("project_name")),
                "ims_id": db.json_value(r.get("ims_id")),
                "ims_project_number": db.json_value(r.get("ims_project_number")),
                "status": status or None,
                "date_start": db.json_value(r.get("date_start")),
                "date_end": db.json_value(r.get("date_end")),
                "offer_breakdown": completed,
            }
        )

    out: dict[str, Any] = {
        "verb": "project_status",
        "casino_id": cid,
        "projects": projects,
        "total": len(projects),
    }
    if any(p.get("offer_breakdown") for p in projects):
        out["follow_up_prompt"] = "Want a breakdown of what was done?"
    return out


def project_breakdown(casino_id: str, project_id: str) -> dict[str, Any]:
    cid = _require_casino(casino_id)
    pid = (project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")

    headers = db.query(
        """
        SELECT
            pc.reference_key,
            pc.ims_project_number AS project_number,
            pc.project_name,
            pc.casino_id,
            c.casino_name
        FROM projects.project_catalog AS pc
        LEFT JOIN clients.casinos AS c ON c.reference_key = pc.casino_id
        WHERE pc.reference_key = %s
           OR pc.ims_id = %s
           OR CAST(pc.ims_project_number AS nvarchar(50)) = %s
        """,
        (pid, pid, pid),
    )
    if not headers:
        raise HTTPException(status_code=404, detail=f"project not found: {pid}")
    h = headers[0]
    proj_casino = (db.json_value(h.get("casino_id")) or "").strip()
    # Cross-property ask (user named another casino / PC id): follow the project's casino.
    if proj_casino and cid != proj_casino:
        cid = proj_casino

    pref = db.json_value(h.get("reference_key"))
    rows = db.query(
        """
        SELECT
            vendor_name,
            cabinet_type,
            serial_number,
            work_notes,
            theme_name
        FROM projects.project_printout
        WHERE project_catalog_reference_key = %s
        ORDER BY work_notes, serial_number
        """,
        (pref,),
    )

    lines = []
    for r in rows:
        vendor = db.json_value(r.get("vendor_name")) or ""
        cabinet = db.json_value(r.get("cabinet_type")) or ""
        serial = db.json_value(r.get("serial_number")) or ""
        action = db.json_value(r.get("work_notes")) or ""
        theme = db.json_value(r.get("theme_name")) or ""
        if not any([vendor, cabinet, serial, action, theme]):
            continue
        action_phrase = _action_phrase(str(action), str(theme))
        parts = [p for p in [vendor, cabinet, f"Serial {serial}" if serial else "", action_phrase] if p]
        lines.append(
            {
                "vendor_name": vendor or None,
                "cabinet_type": cabinet or None,
                "serial_number": serial or None,
                "action": action or None,
                "theme_name": theme or None,
                "summary": " · ".join(parts),
            }
        )

    return {
        "verb": "project_breakdown",
        "casino_id": cid,
        "casino_name": db.json_value(h.get("casino_name")),
        "project_id": pref,
        "project_number": db.json_value(h.get("project_number")),
        "project_name": db.json_value(h.get("project_name")),
        "lines": lines,
        "total": len(lines),
    }


def performance_index(casino_id: str, month_end: date) -> dict[str, Any]:
    """Processed in Master_Revenue for casino-month ⇒ come in; else not_received."""
    cid = _require_casino(casino_id)
    cas = db.query(
        """
        SELECT reference_key, casino_name, casino_short
        FROM clients.casinos
        WHERE reference_key = %s
        """,
        (cid,),
    )
    if not cas:
        raise HTTPException(status_code=404, detail=f"casino not found: {cid}")
    c = cas[0]
    cname = db.json_value(c.get("casino_name"))
    cshort = db.json_value(c.get("casino_short"))

    # Master_Revenue lives on DGS_SLOT; field login needs cross-db SELECT grant (already used elsewhere).
    count_rows = db.query(
        """
        SELECT COUNT(*) AS n
        FROM DGS_SLOT.dbo.Master_Revenue AS mr
        WHERE CAST(mr.[Date] AS date) = %s
          AND (
            RTRIM(mr.Casino) = %s
            OR RTRIM(mr.Casino) = %s
          )
        """,
        (month_end.isoformat(), cname, cshort),
    )
    n = int(count_rows[0].get("n") or 0) if count_rows else 0
    processed = n > 0
    mon_label = f"{month_name[month_end.month]} {month_end.year}"
    if processed:
        label = f"{mon_label} is processed for {cname} ({n} Master_Revenue rows)."
        status = "processed"
    else:
        label = (
            f"{mon_label} has not been processed for {cname} "
            "(no Master_Revenue rows — not 'in' yet)."
        )
        status = "not_received"

    return {
        "verb": "performance_index",
        "casino_id": cid,
        "casino_name": cname,
        "casino_short": cshort,
        "month_end": month_end.isoformat(),
        "processed": processed,
        "mr_row_count": n,
        "status": status,
        "label": label,
    }


def explain_topic(topic_id: str) -> dict[str, Any]:
    tid = (topic_id or "").strip()
    if tid not in EXPLAIN_TOPICS:
        raise HTTPException(
            status_code=400,
            detail=f"topic_id must be one of: {', '.join(sorted(EXPLAIN_TOPICS))}",
        )
    return {"verb": "explain_topic", "topic_id": tid, "text": EXPLAIN_TEXT[tid]}


def _require_casino(casino_id: str) -> str:
    cid = (casino_id or "").strip()
    if not cid:
        raise HTTPException(
            status_code=400,
            detail="casino_id is required (select a casino or pass CT-* in args)",
        )
    return cid


def _parse_month_end(raw: Any) -> date:
    if raw is None or raw == "":
        raise HTTPException(status_code=400, detail="month_end is required (YYYY-MM-DD)")
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    s = str(raw).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="month_end must be YYYY-MM-DD") from exc


def _action_phrase(action: str, theme: str) -> str:
    a = (action or "").strip()
    t = (theme or "").strip()
    al = a.lower()
    if "convert" in al:
        return f"Converted to {t}" if t else a
    if "install" in al:
        return f"Installed {t}" if t else a
    if "remov" in al:
        return f"Removed {t}" if t else a
    if "upgrade" in al:
        return f"Upgraded to {t}" if t else a
    if "move" in al:
        return a
    if t and a:
        return f"{a} · {t}"
    return a or t
