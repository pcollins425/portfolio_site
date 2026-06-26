"""inventory.document + inventory.contract_document — DB sync and upload."""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import PurePosixPath
from typing import Any

from app import mssql
from app.document_paths import build_upload_rel_path, catalog, normalize_relative_path
from app.document_storage import write_bytes


_AUDIT_USER = "dgsapp_document_upload"
_CHANGE_LOG = "Contract document upload via dgsapp"


def _guess_mime(nas_rel_path: str) -> str | None:
    mime, _ = mimetypes.guess_type(nas_rel_path)
    return mime


def _file_fingerprint(data: bytes) -> tuple[str, int]:
    return hashlib.sha256(data).hexdigest(), len(data)


def list_contract_documents(contract_id: str) -> list[dict[str, Any]]:
    rows = mssql.query(
        """
        SELECT
            d.reference_key,
            d.doc_kind,
            d.nas_rel_path,
            d.original_filename,
            d.mime_type,
            d.byte_size,
            d.content_hash,
            cd.role,
            cd.sequence_no
        FROM inventory.contract_document cd
        INNER JOIN inventory.document d ON d.reference_key = cd.document_id
        WHERE cd.contract_id = %s
        ORDER BY
            CASE cd.role WHEN N'agreement' THEN 0 ELSE 1 END,
            cd.sequence_no,
            d.reference_key
        """,
        (contract_id,),
        database=catalog(),
        profile="field",
        load_env=False,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "reference_key": row.get("reference_key"),
                "doc_kind": row.get("doc_kind"),
                "nas_rel_path": row.get("nas_rel_path"),
                "original_filename": row.get("original_filename"),
                "mime_type": row.get("mime_type"),
                "byte_size": int(row["byte_size"]) if row.get("byte_size") is not None else None,
                "content_hash": row.get("content_hash"),
                "role": row.get("role"),
                "sequence_no": int(row["sequence_no"]) if row.get("sequence_no") is not None else None,
            }
        )
    return out


def _get_document_by_path(cur, nas_rel_path: str) -> dict | None:
    cur.execute(
        """
        SELECT reference_key, nas_rel_path, content_hash, doc_kind
        FROM inventory.document
        WHERE nas_rel_path = %s
        """,
        (nas_rel_path,),
    )
    return cur.fetchone()


def _get_document_by_hash(cur, content_hash: str) -> dict | None:
    cur.execute(
        """
        SELECT reference_key, nas_rel_path, content_hash, doc_kind
        FROM inventory.document
        WHERE content_hash = %s
        """,
        (content_hash,),
    )
    return cur.fetchone()


def _upsert_document(
    cur,
    *,
    nas_rel_path: str,
    doc_kind: str,
    content_hash: str,
    byte_size: int,
    update_by: str,
    change_log: str,
) -> str:
    rel = normalize_relative_path(nas_rel_path)
    kind = doc_kind.strip().lower()
    if kind not in {"agreement", "bol"}:
        raise ValueError(f"invalid doc_kind: {doc_kind!r}")

    mime_type = _guess_mime(rel)
    filename = PurePosixPath(rel).name

    by_hash = _get_document_by_hash(cur, content_hash)
    if by_hash:
        return by_hash["reference_key"]

    existing = _get_document_by_path(cur, rel)
    if existing:
        cur.execute(
            """
            UPDATE inventory.document SET
                update_date = SYSUTCDATETIME(),
                update_by = %s,
                change_log = %s,
                content_hash = %s,
                byte_size = %s,
                mime_type = COALESCE(%s, mime_type),
                original_filename = COALESCE(%s, original_filename),
                doc_kind = %s
            WHERE reference_key = %s
            """,
            (update_by, change_log, content_hash, byte_size, mime_type, filename, kind, existing["reference_key"]),
        )
        return existing["reference_key"]

    cur.execute(
        """
        INSERT INTO inventory.document (
            doc_kind, nas_rel_path, content_hash, original_filename, mime_type, byte_size,
            update_by, change_log
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (kind, rel, content_hash, filename, mime_type, byte_size, update_by, change_log),
    )
    cur.execute(
        "SELECT reference_key FROM inventory.document WHERE nas_rel_path = %s",
        (rel,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"document insert failed for {rel!r}")
    return row["reference_key"]


def _upsert_contract_document_link(
    cur,
    *,
    contract_id: str,
    document_id: str,
    role: str,
    sequence_no: int,
    update_by: str,
    change_log: str,
) -> None:
    role_norm = role.strip().lower()
    cur.execute(
        """
        SELECT reference_key
        FROM inventory.contract_document
        WHERE contract_id = %s AND role = %s AND sequence_no = %s
        """,
        (contract_id, role_norm, sequence_no),
    )
    existing_slot = cur.fetchone()
    if existing_slot:
        cur.execute(
            """
            UPDATE inventory.contract_document SET
                update_date = SYSUTCDATETIME(),
                update_by = %s,
                change_log = %s,
                document_id = %s
            WHERE reference_key = %s
            """,
            (update_by, change_log, document_id, existing_slot["reference_key"]),
        )
        return

    cur.execute(
        """
        INSERT INTO inventory.contract_document (
            contract_id, document_id, role, sequence_no, update_by, change_log
        ) VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (contract_id, document_id, role_norm, sequence_no, update_by, change_log),
    )


def _next_bol_sequence(cur, contract_id: str) -> int:
    cur.execute(
        """
        SELECT MAX(sequence_no) AS max_seq
        FROM inventory.contract_document
        WHERE contract_id = %s AND role = N'bol'
        """,
        (contract_id,),
    )
    row = cur.fetchone() or {}
    max_seq = int(row.get("max_seq") or 0)
    if max_seq >= 6:
        raise ValueError("Maximum of 6 BOL documents per agreement")
    return max_seq + 1


def _update_legacy_contract_columns(
    cur,
    *,
    contract_id: str,
    role: str,
    sequence_no: int,
    nas_rel_path: str,
    update_by: str,
) -> None:
    if role == "agreement":
        cur.execute(
            """
            UPDATE inventory.contract SET
                contract_file = %s,
                update_date = SYSUTCDATETIME(),
                update_by = %s,
                change_log = %s
            WHERE reference_key = %s
            """,
            (nas_rel_path, update_by, _CHANGE_LOG, contract_id),
        )
        return
    if role == "bol" and 1 <= sequence_no <= 6:
        col = f"bol_file_{sequence_no}"
        cur.execute(
            f"""
            UPDATE inventory.contract SET
                {col} = %s,
                update_date = SYSUTCDATETIME(),
                update_by = %s,
                change_log = %s
            WHERE reference_key = %s
            """,
            (nas_rel_path, update_by, _CHANGE_LOG, contract_id),
        )


def upload_contract_document(
    *,
    contract_reference_key: str,
    role: str,
    filename: str,
    file_bytes: bytes,
    vendor_name: str,
    agreement_id: str,
    update_by: str = _AUDIT_USER,
) -> dict[str, Any]:
    role_norm = role.strip().lower()
    if role_norm not in {"agreement", "bol"}:
        raise ValueError("role must be agreement or bol")
    if not file_bytes:
        raise ValueError("empty file")
    if not filename.lower().endswith(".pdf"):
        raise ValueError("only PDF uploads are supported")

    content_hash, byte_size = _file_fingerprint(file_bytes)

    conn = mssql.get_connection(database=catalog(), profile="field", load_env=False)
    conn.autocommit(False)
    try:
        cur = conn.cursor(as_dict=True)
        sequence_no = 1
        if role_norm == "bol":
            sequence_no = _next_bol_sequence(cur, contract_reference_key)

        nas_rel_path = build_upload_rel_path(
            role=role_norm,
            vendor_name=vendor_name,
            agreement_id=agreement_id,
            filename=filename,
            sequence_no=sequence_no if role_norm == "bol" else None,
        )

        write_bytes(nas_rel_path, file_bytes)

        doc_id = _upsert_document(
            cur,
            nas_rel_path=nas_rel_path,
            doc_kind=role_norm,
            content_hash=content_hash,
            byte_size=byte_size,
            update_by=update_by,
            change_log=_CHANGE_LOG,
        )
        _upsert_contract_document_link(
            cur,
            contract_id=contract_reference_key,
            document_id=doc_id,
            role=role_norm,
            sequence_no=sequence_no,
            update_by=update_by,
            change_log=_CHANGE_LOG,
        )
        _update_legacy_contract_columns(
            cur,
            contract_id=contract_reference_key,
            role=role_norm,
            sequence_no=sequence_no,
            nas_rel_path=nas_rel_path,
            update_by=update_by,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "reference_key": doc_id,
        "nas_rel_path": nas_rel_path,
        "role": role_norm,
        "sequence_no": sequence_no,
        "original_filename": original_filename(nas_rel_path),
        "byte_size": byte_size,
        "content_hash": content_hash,
    }


def original_filename(nas_rel_path: str) -> str:
    return PurePosixPath(nas_rel_path).name
