"""Resolve casino mentions in Ask AI utterances (don't stick to page selection only)."""

from __future__ import annotations

import re
import time
from typing import Any

from app.page_chat import db

_CACHE: list[dict[str, str]] | None = None
_CACHE_AT = 0.0
_TTL = 300.0

# Too short / too common to match as casino names inside free text.
_STOP_SHORT = frozenset(
    {
        "casino",
        "resort",
        "racing",
        "hotel",
        "club",
        "palace",
        "valley",
        "river",
        "lake",
        "gold",
        "grand",
        "royal",
        "star",
        "stars",
        "island",
        "bay",
        "park",
        "city",
        "town",
        "the",
        "and",
        "for",
        "from",
        "with",
        "this",
        "that",
        "about",
        "project",
        "projects",
        "report",
        "status",
    }
)


def casinos_catalog() -> list[dict[str, str]]:
    global _CACHE, _CACHE_AT
    now = time.time()
    if _CACHE is not None and now - _CACHE_AT < _TTL:
        return _CACHE
    rows = db.query(
        """
        SELECT reference_key, casino_name, casino_short, casino_abbreviation
        FROM clients.casinos
        WHERE reference_key IS NOT NULL
        """
    )
    out: list[dict[str, str]] = []
    for r in rows:
        cid = str(r.get("reference_key") or "").strip()
        if not cid:
            continue
        out.append(
            {
                "casino_id": cid,
                "casino_name": str(r.get("casino_name") or "").strip(),
                "casino_short": str(r.get("casino_short") or "").strip(),
                "casino_abbreviation": str(r.get("casino_abbreviation") or "").strip(),
            }
        )
    _CACHE = out
    _CACHE_AT = now
    return out


def by_name(name: str) -> dict[str, str] | None:
    """Exact / contains match on name or short — single best hit."""
    q = (name or "").strip().lower()
    if not q:
        return None
    hits = []
    for c in casinos_catalog():
        n = c["casino_name"].lower()
        s = c["casino_short"].lower()
        if q == n or q == s or q == c["casino_id"].lower():
            hits.append((1000 + len(q), c))
        elif q in n or q in s or (s and s in q) or (n and n in q):
            hits.append((len(s or n), c))
    if not hits:
        return None
    hits.sort(key=lambda t: t[0], reverse=True)
    return hits[0][1]


def mentioned_in_text(text: str, *, exclude_casino_id: str | None = None) -> list[dict[str, str]]:
    """Casinos whose name/short appears in the utterance (longest match wins per id)."""
    low = (text or "").lower()
    if not low:
        return []
    scored: dict[str, tuple[int, dict[str, str]]] = {}
    for c in casinos_catalog():
        cid = c["casino_id"]
        if exclude_casino_id and cid == exclude_casino_id:
            # Still allow matching the selected casino if named; caller decides.
            pass
        candidates = []
        for label in (c["casino_name"], c["casino_short"]):
            lab = (label or "").strip().lower()
            if len(lab) < 4:
                continue
            if lab in _STOP_SHORT:
                continue
            # Require word-ish boundary so "star" doesn't fire inside "starting"
            if re.search(rf"(?<![a-z0-9]){re.escape(lab)}(?![a-z0-9])", low):
                candidates.append(len(lab))
        # Abbreviation only if 3+ and spaced/punctuated (avoid noise)
        abbr = (c.get("casino_abbreviation") or "").strip().lower()
        if len(abbr) >= 3 and abbr not in _STOP_SHORT:
            if re.search(rf"(?<![a-z0-9]){re.escape(abbr)}(?![a-z0-9])", low):
                candidates.append(len(abbr))
        if not candidates:
            continue
        score = max(candidates)
        prev = scored.get(cid)
        if prev is None or score > prev[0]:
            scored[cid] = (score, c)
    ordered = sorted(scored.values(), key=lambda t: t[0], reverse=True)
    return [c for _, c in ordered]


def resolve_casino_id(
    *,
    text: str,
    args: dict[str, Any] | None,
    session: dict[str, Any],
) -> tuple[str | None, dict[str, Any]]:
    """Pick casino_id for a turn. Prefers explicit args, then named mention, then session.

    Returns (casino_id, meta) where meta may include resolved_from / note for replies.
    """
    args = args or {}
    meta: dict[str, Any] = {}

    explicit = str(args.get("casino_id") or "").strip()
    if explicit:
        meta["resolved_from"] = "args.casino_id"
        return explicit, meta

    name_arg = str(args.get("casino_name") or "").strip()
    if name_arg:
        hit = by_name(name_arg)
        if hit:
            meta["resolved_from"] = "args.casino_name"
            meta["casino_name"] = hit["casino_name"]
            meta["casino_short"] = hit["casino_short"]
            return hit["casino_id"], meta

    session_id = (session.get("casino_id") or "").strip() or None
    mentions = mentioned_in_text(text)
    # Prefer mentions that are NOT the page selection when the user named someone else.
    others = [m for m in mentions if m["casino_id"] != session_id]
    if len(others) == 1:
        hit = others[0]
        meta["resolved_from"] = "utterance"
        meta["casino_name"] = hit["casino_name"]
        meta["casino_short"] = hit["casino_short"]
        meta["cross_casino"] = bool(session_id and hit["casino_id"] != session_id)
        return hit["casino_id"], meta
    if len(others) > 1:
        meta["ambiguous"] = others[:5]
        return None, meta
    if mentions and not others:
        hit = mentions[0]
        meta["resolved_from"] = "utterance_same_as_session"
        return hit["casino_id"], meta

    if session_id:
        meta["resolved_from"] = "session"
        return session_id, meta
    return None, meta
