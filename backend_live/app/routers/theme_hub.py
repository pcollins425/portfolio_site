"""Theme Hub — reference page for one catalog theme, plus the Pre-Check upload.

Documents land in inventory.document (same library as contract PDFs) and
vendors.theme_document. A lab is always a software row plus a jurisdiction.
A par is the theme, for all jurisdictions or one jurisdiction. A slick stays
on the theme and may name a cabinet.

Confirmed tribe jurisdictions, and only these, are their own lab check:
Choctaw Nation (TR-00116) and Shakopee Mdewakanton Sioux Community (TR-00278).
A state letter does not cover those casinos.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app import dgs_projects_workbench_permissions as perms
from app import document_paths, document_storage, mssql
from app import dgs_org_access as org
from app import permission_catalog as cat
from app.auth_deps import require_demo_user
from app.theme_performance import attach_unstamped_months, build_expectation
from app.theme_performance import unavailable as performance_unavailable

router = APIRouter(prefix="/api/theme-hub", tags=["theme-hub"])

# Paul 2026-09-28. Do not add Canada, Puerto Rico, or the Tribal folder.
TRIBE_JURISDICTIONS = (
    ("TR-00116", "Choctaw Nation (Oklahoma)"),
    ("TR-00278", "Shakopee Mdewakanton Sioux Community (Minnesota)"),
)
TRIBE_CODES = frozenset(code for code, _label in TRIBE_JURISDICTIONS)
# Folder names already on \\DGS_Analytics\Compliance\Lab Letters.
TRIBE_FOLDERS = {
    "TR-00116": "Ok-Choctaw",
    "TR-00278": "MN - Shakopee Mdewakanton",
}
MAX_UPLOAD = 25 * 1024 * 1024


def _db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_db(), profile="field", load_env=False)


def _execute(sql: str, params=None) -> int:
    return mssql.execute(sql, params=params, database=_db(), profile="field", load_env=False)


def _json_value(v: Any):
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, str):
        return v.strip()
    return v


def _row(d: dict) -> dict:
    return {k: _json_value(v) for k, v in d.items()}


def _actor(user: dict[str, Any] | None) -> str:
    if not user:
        return "system"
    return str(user.get("email") or user.get("name") or user.get("employee_id") or "unknown")[:50]


def _can_read(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    return perms.can_read(user.get("permissions") or {}) or perms.is_admin(user)


def _can_write(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    if perms.is_admin(user):
        return True
    return perms.can_edit_compliance(user)


def _assert_read(user: dict[str, Any] | None) -> None:
    if not _can_read(user):
        raise HTTPException(status_code=403, detail="No access to Theme Hub")


def _assert_write(user: dict[str, Any] | None) -> None:
    if not _can_write(user):
        raise HTTPException(status_code=403, detail="Adding a par or lab is a Compliance action")


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _jurisdictions() -> list[dict]:
    states = _query(
        """
        SELECT reference_key, state, state_abbreviation
        FROM clients.states
        ORDER BY state
        """
    )
    rows = [
        {
            "code": str(r["reference_key"]),
            "label": str(r["state"]),
            "kind": "state",
            "abbreviation": (r.get("state_abbreviation") or "") or None,
        }
        for r in states
    ]
    for code, label in TRIBE_JURISDICTIONS:
        rows.append({"code": code, "label": label, "kind": "tribe", "abbreviation": None})
    return rows


def _jurisdiction_map() -> dict[str, str]:
    return {row["code"]: row["label"] for row in _jurisdictions()}


def _casino_jurisdiction(casino_id: str) -> dict:
    rows = _query(
        """
        SELECT c.reference_key, c.casino_name, c.casino_short, c.state_id, c.tribe_id,
               s.state, t.tribe_name
        FROM clients.casinos c
        LEFT JOIN clients.states s ON s.reference_key = c.state_id
        LEFT JOIN clients.tribes t ON t.reference_key = c.tribe_id
        WHERE c.reference_key = %s
        """,
        (casino_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Casino not found")
    row = rows[0]
    tribe_id = str(row.get("tribe_id") or "")
    labels = _jurisdiction_map()
    if tribe_id in TRIBE_CODES:
        return {
            "code": tribe_id,
            "label": labels.get(tribe_id) or str(row.get("tribe_name") or tribe_id),
            "tribe_specific": True,
            "note": "A state letter does not cover this casino.",
        }
    state_id = str(row.get("state_id") or "")
    if not state_id:
        return {
            "code": None,
            "label": None,
            "tribe_specific": False,
            "note": "This casino has no jurisdiction on file, so a lab cannot pass.",
        }
    return {
        "code": state_id,
        "label": labels.get(state_id) or str(row.get("state") or state_id),
        "tribe_specific": False,
        "note": None,
    }


def _theme(theme_id: str) -> dict:
    rows = _query(
        """
        SELECT t.reference_key, t.theme_name, t.vendor_id,
               t.slick_media_path, v.vendor_name
        FROM vendors.themes t
        LEFT JOIN vendors.vendors v ON v.reference_key = t.vendor_id
        WHERE t.reference_key = %s
        """,
        (theme_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Theme not found")
    return rows[0]


def _software_rows(theme_id: str) -> list[dict]:
    software = _query(
        """
        SELECT reference_key, software_id, cabinet_id, revoked, lab_letter_media_path,
               CASE
                 WHEN ISJSON(settings) = 1 AND (
                        EXISTS (SELECT 1 FROM OPENJSON(settings, '$.rtp_by_par'))
                     OR NULLIF(JSON_VALUE(settings, '$.paytable_id'), N'') IS NOT NULL
                 ) THEN 1 ELSE 0
               END AS has_settings
        FROM vendors.software
        WHERE theme_id = %s
        ORDER BY software_id, reference_key
        """,
        (theme_id,),
    )
    if not software:
        return []
    refs = [str(r["reference_key"]) for r in software]
    placeholders = ", ".join(["%s"] * len(refs))
    links = _query(
        f"""
        SELECT sc.software_ref, sc.cabinet_id, c.cabinet_name
        FROM vendors.software_cabinet sc
        LEFT JOIN vendors.cabinets c ON c.reference_key = sc.cabinet_id
        WHERE sc.software_ref IN ({placeholders})
        ORDER BY c.cabinet_name, sc.cabinet_id
        """,
        tuple(refs),
    )
    by_ref: dict[str, list[dict]] = {}
    for link in links:
        by_ref.setdefault(str(link["software_ref"]), []).append(
            {
                "cabinet_id": _json_value(link["cabinet_id"]),
                "cabinet_name": _json_value(link.get("cabinet_name")),
            }
        )
    out = []
    for row in software:
        item = _row(row)
        item["cabinets"] = by_ref.get(str(row["reference_key"]), [])
        if not item["cabinets"] and item.get("cabinet_id"):
            item["cabinets"] = [{"cabinet_id": item["cabinet_id"], "cabinet_name": None}]
        out.append(item)
    return out


def _documents(theme_id: str) -> list[dict]:
    labels = _jurisdiction_map()
    rows = _query(
        """
        SELECT td.reference_key, td.doc_kind, td.software_ref, td.cabinet_id,
               td.jurisdiction_code, td.insert_date,
               s.software_id, c.cabinet_name,
               d.nas_rel_path, d.original_filename, d.reference_key AS document_key
        FROM vendors.theme_document td
        JOIN inventory.document d ON d.uuid = td.document_uuid
        LEFT JOIN vendors.software s ON s.reference_key = td.software_ref
        LEFT JOIN vendors.cabinets c ON c.reference_key = td.cabinet_id
        WHERE td.theme_id = %s
        ORDER BY td.doc_kind, td.jurisdiction_code, td.insert_date
        """,
        (theme_id,),
    )
    out = []
    for row in rows:
        item = _row(row)
        code = item.get("jurisdiction_code")
        if code:
            item["jurisdiction_label"] = labels.get(code) or code
        else:
            item["jurisdiction_label"] = "All jurisdictions" if item["doc_kind"] == "par" else None
        out.append(item)
    return out


def _installs(theme_id: str, theme_name: str) -> list[dict]:
    rows = _query(
        """
        SELECT TOP (80)
            c.serial_no, c.compid, c.status, c.date_instl, c.property,
            cas.reference_key AS casino_id, cas.casino_short,
            cab.cabinet_name
        FROM inventory.compinfo_landing c
        LEFT JOIN inventory.assets a ON a.reference_key = c.asset_id
        LEFT JOIN vendors.cabinets cab ON cab.reference_key = a.cabinet_id
        LEFT JOIN clients.casinos cas ON cas.reference_key = c.casino_id
        WHERE c.theme_id = %s
          AND c.rmvl_date IS NULL
        ORDER BY cas.casino_short, c.serial_no
        """,
        (theme_id,),
    )
    placements = [_row(r) for r in rows]
    serials = [p["serial_no"] for p in placements if p.get("serial_no")]
    perf_by_serial: dict[str, dict] = {}
    if serials:
        placeholders = ", ".join(["%s"] * len(serials))
        try:
            perf_rows = _query(
                f"""
                SELECT Serial_number, ADW, TDW, Days_on_Floor, Actual_win, Theme, [date]
                FROM dashboard.vw_performance_report
                WHERE Active = N'Active'
                  AND Serial_number IN ({placeholders})
                """,
                tuple(serials),
            )
        except Exception:
            perf_rows = []
        want = _name_key(theme_name)
        for perf in perf_rows:
            if _name_key(str(perf.get("Theme") or "")) != want:
                continue
            serial = str(perf.get("Serial_number") or "").strip()
            current = perf_by_serial.get(serial)
            stamp = str(perf.get("date") or "")
            if current is None or stamp > str(current.get("date") or ""):
                perf_by_serial[serial] = perf
    for placement in placements:
        perf = perf_by_serial.get(str(placement.get("serial_no") or "").strip())
        if not perf:
            placement["performance"] = None
            continue
        placement["performance"] = {
            "month": _json_value(perf.get("date")),
            "adw": _json_value(perf.get("ADW")),
            "tdw": _json_value(perf.get("TDW")),
            "days_on_floor": _json_value(perf.get("Days_on_Floor")),
            "actual_win": _json_value(perf.get("Actual_win")),
        }
    return placements


def _performance(theme_id: str, theme_name: str) -> dict:
    """Win Index by month of life for this catalog theme. Failure leaves the rest of the page up."""
    try:
        stint_rows = _query(
            """
            SELECT
                sm.reference_key AS slot_master_id,
                COALESCE(NULLIF(LTRIM(RTRIM(sm.asset_id)), N''), sm.reference_key) AS asset_id,
                sm.casino_id,
                sm.theme_id,
                sm.action,
                sm.rmvl_date,
                sm.lastconver,
                sm.golive001,
                sm.date_instl
            FROM inventory.slot_master_migration AS sm
            WHERE sm.theme_id = %s
               OR EXISTS (
                    SELECT 1
                    FROM inventory.slot_master_migration AS src
                    WHERE src.asset_id = sm.asset_id
                      AND src.casino_id = sm.casino_id
                      AND src.theme_id = %s
               )
            """,
            (theme_id, theme_id),
        )
        month_rows = _query(
            """
            SELECT
                sm.reference_key AS slot_master_id,
                CONVERT(date, mr.[date]) AS report_date,
                mr.Days_on_Floor AS days_on_floor,
                CAST(mr.WIN_Index AS float) AS win_index
            FROM inventory.slot_master_migration AS sm
            INNER JOIN dashboard.vw_performance_report AS mr
                ON mr.slot_master_id = sm.reference_key
            WHERE sm.theme_id = %s
              AND mr.[date] IS NOT NULL
              AND mr.WIN_Index IS NOT NULL
            """,
            (theme_id,),
        )
        blank_rows = _query(
            """
            SELECT
                sm.reference_key AS slot_master_id,
                a.serial_number,
                sm.casino_id,
                CONVERT(date, mr.[date]) AS report_date,
                mr.Days_on_Floor AS days_on_floor,
                CAST(mr.WIN_Index AS float) AS win_index,
                mr.Theme AS mr_theme
            FROM inventory.slot_master_migration AS sm
            INNER JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            INNER JOIN dashboard.vw_performance_report AS mr
                ON mr.Serial_number = a.serial_number
               AND (mr.Casino = c.casino_short OR mr.Casino = c.casino_name)
            WHERE sm.theme_id = %s
              AND (mr.slot_master_id IS NULL OR LTRIM(RTRIM(mr.slot_master_id)) = N'')
              AND mr.[date] IS NOT NULL
              AND mr.WIN_Index IS NOT NULL
            """,
            (theme_id,),
        )
    except Exception:
        return performance_unavailable()
    stints = [{str(k).lower(): v for k, v in row.items()} for row in stint_rows]
    months = [{str(k).lower(): v for k, v in row.items()} for row in month_rows]
    blanks = [{str(k).lower(): v for k, v in row.items()} for row in blank_rows]
    months.extend(attach_unstamped_months(stints, blanks, theme_id, theme_name))
    return build_expectation(stints, months, theme_id)


def _kits(theme_name: str) -> list[dict]:
    prefix = f"Kit: {theme_name}%"
    rows = _query(
        """
        SELECT k.kit_item, k.descrip, kl.component_item, kl.qty
        FROM inventory.kit k
        LEFT JOIN inventory.kit_line kl ON kl.kit_item = k.kit_item
        WHERE k.descrip LIKE %s
        ORDER BY k.kit_item, kl.component_item
        """,
        (prefix,),
    )
    grouped: dict[str, dict] = {}
    for row in rows:
        key = str(row["kit_item"])
        bucket = grouped.setdefault(
            key,
            {"kit_item": key, "descrip": _json_value(row.get("descrip")), "lines": []},
        )
        if row.get("component_item"):
            bucket["lines"].append(
                {
                    "component_item": _json_value(row["component_item"]),
                    "qty": _json_value(row.get("qty")),
                }
            )
    return list(grouped.values())


def _sync_cabinet_string(software_ref: str, actor: str) -> None:
    rows = _query(
        """
        SELECT cabinet_id
        FROM vendors.software_cabinet
        WHERE software_ref = %s
        ORDER BY cabinet_id
        """,
        (software_ref,),
    )
    joined = ", ".join(str(r["cabinet_id"]) for r in rows)
    if not joined or len(joined) > 100:
        return
    _execute(
        """
        UPDATE vendors.software
        SET cabinet_id = %s, update_date = GETDATE(), update_by = %s
        WHERE reference_key = %s
        """,
        (joined, actor, software_ref),
    )


def _add_cabinet(software_ref: str, cabinet_id: str, theme_id: str, actor: str) -> None:
    software = _query(
        """
        SELECT reference_key, theme_id
        FROM vendors.software
        WHERE reference_key = %s
        """,
        (software_ref,),
    )
    if not software or str(software[0]["theme_id"]) != theme_id:
        raise HTTPException(status_code=400, detail="That software is not on this theme")
    cabinet = _query(
        "SELECT reference_key FROM vendors.cabinets WHERE reference_key = %s",
        (cabinet_id,),
    )
    if not cabinet:
        raise HTTPException(status_code=400, detail="Unknown cabinet")
    _execute(
        """
        INSERT INTO vendors.software_cabinet (software_ref, cabinet_id, update_by)
        SELECT %s, %s, %s
        WHERE NOT EXISTS (
            SELECT 1 FROM vendors.software_cabinet
            WHERE software_ref = %s AND cabinet_id = %s
        )
        """,
        (software_ref, cabinet_id, actor, software_ref, cabinet_id),
    )
    _sync_cabinet_string(software_ref, actor)


def _create_software(theme_id: str, program_id: str, cabinet_id: str, actor: str) -> str:
    program_id = program_id.strip()
    if not program_id or len(program_id) > 50:
        raise HTTPException(status_code=400, detail="Program id is required")
    existing = _query(
        """
        SELECT reference_key
        FROM vendors.software
        WHERE theme_id = %s AND software_id = %s AND ISNULL(revoked, 0) = 0
        """,
        (theme_id, program_id),
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Program {program_id} is already {existing[0]['reference_key']}. "
                "Add the cabinet to that software."
            ),
        )
    cabinet = _query(
        "SELECT reference_key FROM vendors.cabinets WHERE reference_key = %s",
        (cabinet_id,),
    )
    if not cabinet:
        raise HTTPException(status_code=400, detail="Unknown cabinet")
    nxt_rows = _query("SELECT NEXT VALUE FOR vendors.seq_vendors_software_index_key AS nxt")
    nxt = int(nxt_rows[0]["nxt"])
    ref = f"SFW-{nxt:06d}"
    _execute(
        """
        INSERT INTO vendors.software (
            reference_key, index_key, software_id, theme_id, cabinet_id,
            settings, revoked, insert_date, update_date, update_by, change_log
        ) VALUES (
            %s, %s, %s, %s, %s,
            NULL, 0, GETDATE(), GETDATE(), %s, %s
        )
        """,
        (ref, nxt, program_id, theme_id, cabinet_id, actor, "theme hub new software"),
    )
    _add_cabinet(ref, cabinet_id, theme_id, actor)
    return ref


def _folder(raw: str) -> str:
    text = (raw or "Unknown").replace(":", " - ")
    text = re.sub(r"\s+", " ", text).strip(" .")
    return document_paths.sanitize_path_segment(text)


def _jurisdiction_folder(code: str | None) -> str:
    if not code:
        return "All jurisdictions"
    if code in TRIBE_FOLDERS:
        return TRIBE_FOLDERS[code]
    return _folder(_jurisdiction_map().get(code) or code)


def _compliance_rel(
    theme: dict,
    kind: str,
    filename: str,
    jurisdiction_code: str | None,
    cabinet_id: str | None,
) -> str:
    """File under Analytics ``Compliance``, beside the existing lab/par/slick trees."""
    vendor = _folder(str(theme.get("vendor_name") or "Unknown"))
    theme_folder = _folder(str(theme.get("theme_name") or theme["reference_key"]))
    safe_name = document_paths.sanitize_upload_filename(filename)
    if kind == "lab":
        rel = (
            f"Compliance/Lab Letters/{_jurisdiction_folder(jurisdiction_code)}"
            f"/{vendor}/Themes/{theme_folder}/{safe_name}"
        )
    elif kind == "par":
        rel = (
            f"Compliance/Par Sheets/{vendor}/{theme_folder}"
            f"/{_jurisdiction_folder(jurisdiction_code)}/{safe_name}"
        )
    else:
        rel = f"Compliance/Slicks/{vendor}/{theme_folder}"
        if cabinet_id:
            names = _query(
                "SELECT cabinet_name FROM vendors.cabinets WHERE reference_key = %s",
                (cabinet_id,),
            )
            cab = _folder(str(names[0]["cabinet_name"]) if names else cabinet_id)
            rel = f"{rel}/{cab}"
        rel = f"{rel}/{safe_name}"
    return document_paths.normalize_relative_path(rel)


def _store_pdf(kind: str, filename: str, data: bytes, rel: str) -> str:
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=400, detail="File is over 25 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Upload a PDF")
    digest = hashlib.sha256(data).hexdigest()
    existing = _query(
        """
        SELECT TOP 1 uuid, nas_rel_path
        FROM inventory.document
        WHERE content_hash = %s
        """,
        (digest,),
    )
    if existing:
        return str(existing[0]["uuid"])
    if _query("SELECT 1 AS n FROM inventory.document WHERE nas_rel_path = %s", (rel,)):
        stem, ext = os.path.splitext(rel)
        rel = document_paths.normalize_relative_path(f"{stem}-{digest[:8]}{ext}")
    try:
        document_storage.write_bytes(rel, data)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Document storage is not configured") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not store the file: {exc}") from exc
    _execute(
        """
        INSERT INTO inventory.document (
            doc_kind, nas_rel_path, content_hash, original_filename, mime_type, byte_size, update_by
        ) VALUES (%s, %s, %s, %s, N'application/pdf', %s, %s)
        """,
        (kind, rel, digest, filename[:260], len(data), "theme_hub"),
    )
    stored = _query(
        "SELECT uuid FROM inventory.document WHERE nas_rel_path = %s",
        (rel,),
    )
    if not stored:
        raise HTTPException(status_code=500, detail="Document row was not saved")
    return str(stored[0]["uuid"])


def _link_document(
    theme_id: str,
    document_uuid: str,
    kind: str,
    actor: str,
    *,
    software_ref: str | None,
    cabinet_id: str | None,
    jurisdiction_code: str | None,
) -> str:
    nxt = int(_query("SELECT NEXT VALUE FOR vendors.seq_theme_document AS nxt")[0]["nxt"])
    ref = f"THD-{nxt:06d}"
    _execute(
        """
        INSERT INTO vendors.theme_document (
            index_key, reference_key, theme_id, document_uuid, doc_kind,
            software_ref, cabinet_id, jurisdiction_code, update_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            nxt,
            ref,
            theme_id,
            document_uuid,
            kind,
            software_ref,
            cabinet_id,
            jurisdiction_code,
            actor,
        ),
    )
    return ref


@router.get("/jurisdictions")
def list_jurisdictions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    return {"items": _jurisdictions()}


@router.get("/cabinets")
def search_cabinets(
    q: str = Query("", max_length=80),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    search = q.strip()
    if len(search) < 2:
        return {"items": []}
    like = f"%{search}%"
    rows = _query(
        """
        SELECT TOP (20) c.reference_key, c.cabinet_name, v.vendor_name
        FROM vendors.cabinets c
        LEFT JOIN vendors.vendors v ON v.reference_key = c.vendor_id
        WHERE c.cabinet_name LIKE %s OR c.reference_key LIKE %s
        ORDER BY c.cabinet_name
        """,
        (like, like),
    )
    return {"items": [_row(r) for r in rows]}


@router.get("/{theme_id}")
def theme_detail(
    theme_id: str,
    proposal: str = Query("", max_length=40),
    unit: str = Query("", max_length=40),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    theme = _theme(theme_id.strip())
    theme_key = str(theme["reference_key"])
    payload = {
        "theme": _row(theme),
        "can_write": _can_write(user),
        "performance": None
        if not org.has_read(user, cat.PERFORMANCE_AREA)
        else _performance(theme_key, str(theme["theme_name"])),
        "software": _software_rows(theme_key),
        "documents": _documents(theme_key),
        "installs": _installs(theme_key, str(theme["theme_name"])),
        "kits": _kits(str(theme["theme_name"])),
        "jurisdictions": _jurisdictions(),
        "add_context": None,
    }
    if proposal.strip():
        proposals = _query(
            """
            SELECT uuid, reference_key, casino_id
            FROM projects.proposal
            WHERE reference_key = %s OR CAST(uuid AS nvarchar(36)) = %s
            """,
            (proposal.strip(), proposal.strip()),
        )
        if not proposals:
            raise HTTPException(status_code=404, detail="Proposal not found")
        context = {
            "proposal": str(proposals[0]["reference_key"]),
            "jurisdiction": _casino_jurisdiction(str(proposals[0]["casino_id"])),
            "unit": None,
        }
        if unit.strip():
            units = _query(
                """
                SELECT uuid, cabinet_id, proposed_theme_id
                FROM projects.proposal_unit
                WHERE proposal_id = %s
                  AND (CAST(uuid AS nvarchar(36)) = %s)
                """,
                (str(proposals[0]["uuid"]), unit.strip()),
            )
            if not units:
                raise HTTPException(status_code=404, detail="Unit not found")
            if str(units[0]["proposed_theme_id"]) != theme_key:
                raise HTTPException(status_code=400, detail="That unit is not this theme")
            cabinet_id = str(units[0].get("cabinet_id") or "")
            cabinet_name = None
            if cabinet_id:
                names = _query(
                    "SELECT cabinet_name FROM vendors.cabinets WHERE reference_key = %s",
                    (cabinet_id,),
                )
                if names:
                    cabinet_name = names[0]["cabinet_name"]
            context["unit"] = {
                "uuid": str(units[0]["uuid"]),
                "cabinet_id": cabinet_id or None,
                "cabinet_name": _json_value(cabinet_name) if cabinet_name else None,
            }
        payload["add_context"] = context
    return payload


@router.post("/{theme_id}/software/{software_ref}/cabinets")
def associate_cabinet(
    theme_id: str,
    software_ref: str,
    cabinet_id: str = Form(...),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    theme = _theme(theme_id.strip())
    _add_cabinet(software_ref.strip(), cabinet_id.strip(), str(theme["reference_key"]), _actor(user))
    return {"ok": True, "software": _software_rows(str(theme["reference_key"]))}


@router.post("/{theme_id}/software")
def create_software(
    theme_id: str,
    software_id: str = Form(...),
    cabinet_id: str = Form(...),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    theme = _theme(theme_id.strip())
    ref = _create_software(
        str(theme["reference_key"]),
        software_id,
        cabinet_id.strip(),
        _actor(user),
    )
    return {"ok": True, "software_ref": ref, "software": _software_rows(str(theme["reference_key"]))}


@router.post("/{theme_id}/documents")
async def add_document(
    theme_id: str,
    doc_kind: str = Form(...),
    file: UploadFile = File(...),
    jurisdiction_code: str = Form(""),
    software_ref: str = Form(""),
    new_software_id: str = Form(""),
    cabinet_id: str = Form(""),
    associate_cabinet: str = Form(""),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    theme = _theme(theme_id.strip())
    theme_key = str(theme["reference_key"])
    kind = doc_kind.strip().lower()
    if kind not in {"par", "lab", "slick"}:
        raise HTTPException(status_code=400, detail="Document must be a par, lab, or slick")
    actor = _actor(user)
    code = jurisdiction_code.strip() or None
    allowed = _jurisdiction_map()
    if code and code not in allowed:
        raise HTTPException(status_code=400, detail="Unknown jurisdiction")
    cabinet = cabinet_id.strip() or None
    software = software_ref.strip() or None

    if kind == "lab":
        if not code:
            raise HTTPException(status_code=400, detail="A lab letter needs a jurisdiction")
        if new_software_id.strip():
            if not cabinet:
                raise HTTPException(status_code=400, detail="New software needs a cabinet")
            software = _create_software(theme_key, new_software_id, cabinet, actor)
        elif not software:
            raise HTTPException(status_code=400, detail="A lab letter needs software")
        elif associate_cabinet.strip() in {"1", "true", "yes"}:
            if not cabinet:
                raise HTTPException(status_code=400, detail="Name the cabinet to add")
            _add_cabinet(software, cabinet, theme_key, actor)
        cabinet = None
    elif kind == "par":
        software = None
        cabinet = None
    else:
        software = None
        if cabinet:
            known = _query(
                "SELECT reference_key FROM vendors.cabinets WHERE reference_key = %s",
                (cabinet,),
            )
            if not known:
                raise HTTPException(status_code=400, detail="Unknown cabinet")

    data = await file.read()
    filename = file.filename or f"{kind}.pdf"
    try:
        rel = _compliance_rel(theme, kind, filename, code, cabinet)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    document_uuid = _store_pdf(kind, filename, data, rel)
    ref = _link_document(
        theme_key,
        document_uuid,
        kind,
        actor,
        software_ref=software,
        cabinet_id=cabinet,
        jurisdiction_code=code,
    )
    return {
        "ok": True,
        "reference_key": ref,
        "documents": _documents(theme_key),
        "software": _software_rows(theme_key),
    }
