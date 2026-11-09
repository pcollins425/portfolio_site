"""Build a Leased Equipment Software Conversion Request .docx from Workbench SQL.

Stdlib only (zip + OOXML). WordCraft opens these bytes via the host bridge.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any
from xml.sax.saxutils import escape


def _t(text: Any) -> str:
    return escape("" if text is None else str(text))


def _p(text: str, *, bold: bool = False) -> str:
    r_pr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return (
        "<w:p>"
        f"<w:r>{r_pr}<w:t xml:space=\"preserve\">{_t(text)}</w:t></w:r>"
        "</w:p>"
    )


def _empty_p() -> str:
    return "<w:p/>"


def _cell(text: str) -> str:
    return (
        "<w:tc>"
        "<w:tcPr><w:tcW w:w=\"1200\" w:type=\"dxa\"/></w:tcPr>"
        f"{_p(text)}"
        "</w:tc>"
    )


def _row(cells: list[str], *, header: bool = False) -> str:
    body = "".join(_cell(c) for c in cells)
    if header:
        return f"<w:tr><w:trPr><w:tblHeader/></w:trPr>{body}</w:tr>"
    return f"<w:tr>{body}</w:tr>"


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


def build_conversion_request_docx(detail: dict[str, Any]) -> bytes:
    p = detail.get("proposal") or {}
    units = detail.get("units") or []
    casino = p.get("casino_name") or p.get("casino_short") or "Casino Name"
    contact = (
        p.get("letter_contact_name")
        or p.get("slot_director_name")
        or p.get("general_manager_name")
        or "Direct Contact"
    )
    email = (
        p.get("letter_contact_email")
        or p.get("slot_director_email")
        or p.get("general_manager_email")
        or "Direct Contact Email"
    )
    line1 = p.get("letter_address_line1") or p.get("casino_address") or "Address Line #1"
    line2 = p.get("letter_address_line2") or "Address Line #2"
    req = p.get("reference_key") or "Request"

    headers = [
        "Manufacturer",
        "Cabinet",
        "Serial #",
        "Theme (From)",
        "Theme (To)",
        "Z-B-L",
        "RTP Target",
        "Denom",
        "Bet Config",
        "Restrictions",
    ]
    rows_xml = [_row(headers, header=True)]
    for u in units:
        rows_xml.append(
            _row(
                [
                    str(u.get("manufacturer_name") or ""),
                    str(u.get("cabinet_name") or u.get("cabinet_id") or ""),
                    str(u.get("serial") or ""),
                    str(u.get("current_theme_name") or ""),
                    _theme_to(u),
                    _zbl(u),
                    str(u.get("rtp_target") or ""),
                    str(u.get("denom") or ""),
                    str(u.get("bet_config") or ""),
                    str(u.get("restrictions") or ""),
                ]
            )
        )
    if not units:
        rows_xml.append(_row(["(no units)"] + [""] * 9))

    table = (
        "<w:tbl>"
        "<w:tblPr>"
        '<w:tblW w:w="0" w:type="auto"/>'
        "<w:tblBorders>"
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
        "</w:tblBorders>"
        "</w:tblPr>"
        f"{''.join(rows_xml)}"
        "</w:tbl>"
    )

    body = "".join(
        [
            _p("Leased Equipment Software Conversion Request", bold=True),
            _p(str(casino), bold=True),
            _p(str(contact)),
            _p(str(email)),
            _p(str(line1)),
            _p(str(line2)),
            _p(f"Request # {req}", bold=True),
            _empty_p(),
            _p("Hello,"),
            _p(
                "Pending your approval, Dynamic Gaming Solutions, LLC would like to "
                f"perform the following software conversions to our leased equipment at the {casino}. "
                "As always, we thank you for your continued partnership."
            ),
            _p("Respectfully,"),
            _empty_p(),
            _p("Convert", bold=True),
            table,
        ]
    )

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}<w:sectPr/></w:body>"
        "</w:document>"
    )
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    doc_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>
"""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
    return buf.getvalue()
