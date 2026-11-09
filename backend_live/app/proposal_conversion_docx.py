"""Fill David's conversion-request .docx template from Workbench SQL.

Keeps logo/header/styles/table grid from the real ops template so WordCraft's
first open looks like the familiar letter (not a bare OOXML stub).
"""

from __future__ import annotations

import copy
import io
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
TEMPLATE_PATH = Path(__file__).resolve().parent / "templates" / "conversion_proposal.docx"

# Preserve Word namespaces on write.
for prefix, uri in (
    ("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main"),
    ("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"),
    ("wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"),
    ("a", "http://schemas.openxmlformats.org/drawingml/2006/main"),
    ("pic", "http://schemas.openxmlformats.org/drawingml/2006/picture"),
    ("w14", "http://schemas.microsoft.com/office/word/2010/wordml"),
    ("w15", "http://schemas.microsoft.com/office/word/2012/wordml"),
    ("mc", "http://schemas.openxmlformats.org/markup-compatibility/2006"),
    ("wpc", "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"),
    ("wpg", "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"),
    ("wpi", "http://schemas.microsoft.com/office/word/2010/wordprocessingInk"),
    ("wps", "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"),
):
    ET.register_namespace(prefix, uri)


def _para_text(p: ET.Element) -> str:
    return "".join(t.text or "" for t in p.iter(f"{W}t"))


def _set_para_text(p: ET.Element, text: str) -> None:
    """Replace a simple paragraph's visible text, keeping the first run's rPr."""
    runs = list(p.findall(f"{W}r"))
    if not runs:
        r = ET.SubElement(p, f"{W}r")
        t = ET.SubElement(r, f"{W}t")
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        t.text = text
        return
    first = runs[0]
    # Drop extra runs (template splits some placeholders across runs).
    for extra in runs[1:]:
        p.remove(extra)
    t_el = first.find(f"{W}t")
    if t_el is None:
        t_el = ET.SubElement(first, f"{W}t")
    t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t_el.text = text


def _set_cell_text(tc: ET.Element, text: str) -> None:
    p = tc.find(f"{W}p")
    if p is None:
        p = ET.SubElement(tc, f"{W}p")
    runs = list(p.findall(f"{W}r"))
    if not runs:
        r = ET.SubElement(p, f"{W}r")
        r_pr = p.find(f"{W}pPr/{W}rPr")
        if r_pr is not None:
            r.insert(0, copy.deepcopy(r_pr))
        t = ET.SubElement(r, f"{W}t")
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        t.text = text
        return
    first = runs[0]
    for extra in runs[1:]:
        p.remove(extra)
    t_el = first.find(f"{W}t")
    if t_el is None:
        t_el = ET.SubElement(first, f"{W}t")
    t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t_el.text = text


def _zbl(unit: dict[str, Any]) -> str:
    parts = [unit.get("zone"), unit.get("bank"), unit.get("location")]
    vals = [str(p).strip() for p in parts if p is not None and str(p).strip()]
    return "-".join(vals) if vals else ""


def _theme_to(unit: dict[str, Any]) -> str:
    op = str(unit.get("op") or "").upper()
    if op == "REMOVE":
        return "(remove)"
    if unit.get("unverified_theme_name"):
        return str(unit["unverified_theme_name"])
    if unit.get("proposed_theme_name"):
        return str(unit["proposed_theme_name"])
    if unit.get("is_tbd") in (1, True, "1") or str(unit.get("software_state") or "") == "tbd":
        return "TBD"
    return ""


def _fill_document_xml(document_xml: bytes, detail: dict[str, Any]) -> bytes:
    p = detail.get("proposal") or {}
    units = detail.get("units") or []
    casino = str(p.get("casino_name") or p.get("casino_short") or "Casino Name")
    contact = str(
        p.get("letter_contact_name")
        or p.get("slot_director_name")
        or p.get("general_manager_name")
        or "Direct Contact"
    )
    email = str(
        p.get("letter_contact_email")
        or p.get("slot_director_email")
        or p.get("general_manager_email")
        or "Direct Contact Email"
    )
    line1 = str(p.get("letter_address_line1") or p.get("casino_address") or "Address Line #1")
    line2 = str(p.get("letter_address_line2") or "Address Line #2")
    req = str(p.get("reference_key") or "Request")

    root = ET.fromstring(document_xml)
    body = root.find(f"{W}body")
    if body is None:
        raise RuntimeError("Template document.xml missing body")

    paras = [c for c in list(body) if c.tag == f"{W}p"]
    # David template paragraph order (stable).
    replacements = {
        0: casino,
        1: contact,
        2: email,
        3: line1,
        4: line2,
        5: f"Request # {req}",
        7: "Hello,",
        9: (
            "Pending your approval, Dynamic Gaming Solutions, LLC would like to perform "
            f"the following software conversions to our leased equipment at the {casino}. "
            "As always, we thank you for your continued partnership."
        ),
        11: "Respectfully,",
        12: "Convert",
    }
    for idx, text in replacements.items():
        if idx < len(paras):
            _set_para_text(paras[idx], text)

    tbl = body.find(f"{W}tbl")
    if tbl is None:
        raise RuntimeError("Template document.xml missing convert table")
    rows = list(tbl.findall(f"{W}tr"))
    if len(rows) < 2:
        raise RuntimeError("Template convert table missing data-row pattern")
    header = rows[0]
    blank = rows[1]
    # Drop existing data rows; rebuild from unit lines (core 6 cols like David).
    for old in rows[1:]:
        tbl.remove(old)

    line_values: list[list[str]] = []
    for u in units:
        line_values.append(
            [
                str(u.get("manufacturer_name") or ""),
                str(u.get("cabinet_name") or u.get("cabinet_id") or ""),
                str(u.get("serial") or ""),
                str(u.get("current_theme_name") or ""),
                _theme_to(u),
                _zbl(u),
            ]
        )
    # Keep a few blank rows when empty so the letter still looks like the template.
    if not line_values:
        line_values = [["", "", "", "", "", ""]] * 4

    for vals in line_values:
        tr = copy.deepcopy(blank)
        cells = list(tr.findall(f"{W}tc"))
        for i, val in enumerate(vals):
            if i < len(cells):
                _set_cell_text(cells[i], val)
        tbl.append(tr)

    # Ensure header stays first (already is).
    _ = header
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build_conversion_request_docx(detail: dict[str, Any]) -> bytes:
    if not TEMPLATE_PATH.is_file():
        raise FileNotFoundError(f"Missing conversion template: {TEMPLATE_PATH}")

    buf = io.BytesIO()
    with zipfile.ZipFile(TEMPLATE_PATH, "r") as src, zipfile.ZipFile(
        buf, "w", compression=zipfile.ZIP_DEFLATED
    ) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "word/document.xml":
                data = _fill_document_xml(data, detail)
            dst.writestr(info, data)
    return buf.getvalue()
