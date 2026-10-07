"""Mail intake DB helpers for ops.mail_* (DGS App API)."""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from app import mssql

DESIGNATIONS = frozenset({"unset", "revenue", "fsr", "ignore"})


def _db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_db(), profile="field", load_env=False)


def _execute(sql: str, params=None) -> int:
    return mssql.execute(sql, params=params, database=_db(), profile="field", load_env=False)


def json_value(v: Any):
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v


def row_out(row: dict) -> dict:
    return {k: json_value(v) for k, v in dict(row).items()}


def list_intake(
    *,
    designation: str | None = None,
    mailbox: str | None = None,
    process_status: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    clauses = ["1=1"]
    params: list[Any] = []
    if designation:
        clauses.append("designation = %s")
        params.append(designation)
    if mailbox:
        clauses.append("mailbox = %s")
        params.append(mailbox)
    if process_status:
        clauses.append("process_status = %s")
        params.append(process_status)
    if q:
        clauses.append(
            "(subject LIKE %s OR gmail_from LIKE %s OR snippet LIKE %s OR message_id LIKE %s)"
        )
        like = f"%{q.strip()}%"
        params.extend([like, like, like, like])
    where = " AND ".join(clauses)
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    rows = _query(
        f"""
        SELECT *
        FROM ops.mail_intake
        WHERE {where}
        ORDER BY COALESCE(internal_date, checked_at) DESC
        OFFSET %s ROWS FETCH NEXT %s ROWS ONLY
        """,
        tuple(params + [off, lim]),
    )
    return [row_out(r) for r in rows]


def count_unset() -> int:
    rows = _query(
        """
        SELECT COUNT(1) AS c
        FROM ops.mail_intake
        WHERE designation = N'unset'
        """
    )
    return int(rows[0]["c"]) if rows else 0


def get_by_uuid(intake_uuid: str) -> dict | None:
    rows = _query(
        "SELECT TOP 1 * FROM ops.mail_intake WHERE uuid = %s",
        (intake_uuid,),
    )
    return row_out(rows[0]) if rows else None


def get_job(job_id: str) -> dict | None:
    rows = _query(
        "SELECT TOP 1 * FROM ops.mail_process_job WHERE job_id = %s",
        (job_id,),
    )
    if not rows:
        return None
    out = row_out(rows[0])
    raw = out.get("summary_json")
    if isinstance(raw, str) and raw:
        try:
            out["summary"] = json.loads(raw)
        except json.JSONDecodeError:
            out["summary"] = None
    else:
        out["summary"] = raw if isinstance(raw, dict) else None
    return out


def list_jobs_for_intake(intake_uuid: str, limit: int = 20) -> list[dict]:
    lim = max(1, min(int(limit), 50))
    rows = _query(
        f"""
        SELECT TOP ({lim}) *
        FROM ops.mail_process_job
        WHERE intake_uuid = %s
        ORDER BY created_at DESC
        """,
        (intake_uuid,),
    )
    out = []
    for r in rows:
        item = row_out(r)
        raw = item.get("summary_json")
        if isinstance(raw, str) and raw:
            try:
                item["summary"] = json.loads(raw)
            except json.JSONDecodeError:
                item["summary"] = None
        out.append(item)
    return out


def designate_many(
    *,
    uuids: list[str],
    designation: str,
    actor: str,
) -> list[dict]:
    if designation not in DESIGNATIONS:
        raise ValueError(f"invalid designation: {designation}")
    results = []
    for uid in uuids:
        intake = get_by_uuid(uid)
        if not intake:
            results.append({"uuid": uid, "ok": False, "error": "not_found"})
            continue
        prev = str(intake.get("designation") or "unset")
        if prev == designation:
            results.append({"uuid": uid, "ok": True, "designation": designation, "unchanged": True})
            continue
        _execute(
            """
            INSERT INTO ops.mail_designation_event (
                intake_uuid, mailbox, message_id, thread_id, gmail_from, subject, snippet,
                has_attachments, attachment_names, from_designation, to_designation, actor
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """,
            (
                intake["uuid"],
                intake["mailbox"],
                intake["message_id"],
                intake.get("thread_id"),
                intake.get("gmail_from"),
                intake.get("subject"),
                intake.get("snippet"),
                1 if intake.get("has_attachments") else 0,
                intake.get("attachment_names"),
                prev,
                designation,
                (actor or "unknown")[:120],
            ),
        )
        _execute(
            """
            UPDATE ops.mail_intake
            SET designation = %s,
                designated_by = %s,
                designated_at = SYSUTCDATETIME()
            WHERE uuid = %s
            """,
            (designation, (actor or "unknown")[:120], uid),
        )
        results.append({"uuid": uid, "ok": True, "designation": designation, "from": prev})
    return results


def enqueue_process(
    *,
    uuids: list[str],
    mode: str,
    actor: str,
) -> list[dict]:
    if mode not in ("dry_run", "apply"):
        raise ValueError(f"invalid mode: {mode}")
    results = []
    for uid in uuids:
        intake = get_by_uuid(uid)
        if not intake:
            results.append({"uuid": uid, "ok": False, "error": "not_found"})
            continue
        designation = str(intake.get("designation") or "")
        if designation not in ("revenue", "fsr"):
            results.append(
                {
                    "uuid": uid,
                    "ok": False,
                    "error": "must_designate_revenue_or_fsr",
                    "designation": designation,
                }
            )
            continue
        if mode == "apply":
            # Require a prior successful dry-run (or needs_human explicitly allowed? Plan says dry_run_ok)
            prior = _query(
                """
                SELECT TOP 1 job_id, status
                FROM ops.mail_process_job
                WHERE intake_uuid = %s AND mode = N'dry_run'
                  AND status = N'dry_run_ok'
                ORDER BY finished_at DESC
                """,
                (uid,),
            )
            if not prior:
                results.append(
                    {
                        "uuid": uid,
                        "ok": False,
                        "error": "need_dry_run_ok_before_apply",
                    }
                )
                continue
        job_id = str(uuid.uuid4())
        _execute(
            """
            INSERT INTO ops.mail_process_job (
                job_id, intake_uuid, mailbox, message_id, designation, mode, status, requested_by
            ) VALUES (
                %s, %s, %s, %s, %s, %s, N'queued', %s
            )
            """,
            (
                job_id,
                uid,
                intake["mailbox"],
                intake["message_id"],
                designation,
                mode,
                (actor or "unknown")[:120],
            ),
        )
        _execute(
            """
            UPDATE ops.mail_intake
            SET process_status = N'queued', latest_job_id = %s
            WHERE uuid = %s
            """,
            (job_id, uid),
        )
        results.append(
            {
                "uuid": uid,
                "ok": True,
                "job_id": job_id,
                "designation": designation,
                "mode": mode,
            }
        )
    return results


def gmail_open_url(mailbox: str, message_id: str) -> str:
    from urllib.parse import quote

    return (
        "https://mail.google.com/mail/u/"
        f"{quote(mailbox)}#all/{quote(message_id)}"
    )
