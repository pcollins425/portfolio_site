"""Evaluate install-date rules from finance.commission_profile.commission_rules JSON."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any


def _as_date(v: object) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        raw = v.strip()
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw[:19], fmt).date()
            except ValueError:
                continue
    return None


def parse_rules(commission_rules: str | dict | None) -> dict[str, Any]:
    if isinstance(commission_rules, dict):
        return commission_rules
    if not commission_rules:
        return {}
    try:
        return json.loads(commission_rules)
    except (json.JSONDecodeError, TypeError):
        return {}


def freem_anchor_date(row: dict[str, Any], anchor: str) -> date | None:
    a = (anchor or "install").strip().lower()
    if a in ("l", "go_live", "golive", "go-live"):
        return _as_date(row.get("golive001")) or _as_date(row.get("date_instl"))
    return _as_date(row.get("date_instl")) or _as_date(row.get("golive001"))


def in_participation_freem(row: dict[str, Any], rules: dict[str, Any], month_end: date) -> bool:
    freem = rules.get("participation_freem") or {}
    days = int(freem.get("days") or 0)
    if days <= 0:
        return False
    anchor = freem.get("anchor") or "install"
    ad = freem_anchor_date(row, anchor)
    if ad is None:
        return False
    return month_end <= ad + timedelta(days=days)


def reporting_waived(row: dict[str, Any], rules: dict[str, Any], month_end: date) -> bool:
    if not in_participation_freem(row, rules, month_end):
        return False
    reporting = rules.get("reporting") or {}
    return bool(reporting.get("waived_during_freem", False))


def freem_commission_override(rules: dict[str, Any]) -> float | None:
    freem = rules.get("participation_freem") or {}
    if "commission_dollars" in freem:
        return float(freem["commission_dollars"])
    if freem.get("commission") == 0:
        return 0.0
    return None


def commission_with_freem(
    row: dict[str, Any],
    rules_json: str | dict | None,
    month_end: date,
    base_commission: float | None,
) -> float | None:
    """Return freem override when in window; else base_commission."""
    rules = parse_rules(rules_json)
    if not in_participation_freem(row, rules, month_end):
        return base_commission
    override = freem_commission_override(rules)
    if override is not None:
        return round(float(override), 2)
    return base_commission
