"""Unit tests for permission_catalog (no DB)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import permission_catalog as cat  # noqa: E402


def test_parse_and_email_flags():
    blob = "casinos: READ_ONLY, email: approval, email: legal, slot_master: UPDATES_ONLY"
    m = cat.parse_permissions_blob(blob)
    assert m["casinos"] == "READ_ONLY"
    assert m["email: approval"] == "READ_ONLY"
    assert m["email: legal"] == "READ_ONLY"
    assert m["slot_master"] == "UPDATES_ONLY"


def test_merge_none_subtracts():
    role = "casinos: ADDS_AND_UPDATES, employees: UPDATES_ONLY"
    override = "casinos: NONE, slot_master: READ_ONLY"
    eff = cat.merge_permissions(role, override)
    assert "casinos" not in eff
    assert eff["employees"] == "UPDATES_ONLY"
    assert eff["slot_master"] == "READ_ONLY"


def test_overrides_from_effective():
    role = {"casinos": "ADDS_AND_UPDATES", "employees": "READ_ONLY"}
    desired = {"casinos": "READ_ONLY", "employees": "READ_ONLY", "themes": "UPDATES_ONLY"}
    deltas = cat.overrides_from_effective(role, desired)
    assert deltas["casinos"] == "READ_ONLY"
    assert "employees" not in deltas
    assert deltas["themes"] == "UPDATES_ONLY"
    # subtract
    deltas2 = cat.overrides_from_effective(role, {"casinos": None, "employees": "READ_ONLY"})
    assert deltas2["casinos"] == "NONE"


def test_escalation_cap():
    actor = {"casinos": "UPDATES_ONLY", "employees": "ADDS_AND_UPDATES"}
    assert cat.can_grant(actor, "casinos", "READ_ONLY")
    assert cat.can_grant(actor, "casinos", "UPDATES_ONLY")
    assert not cat.can_grant(actor, "casinos", "ADDS_AND_UPDATES")
    assert cat.can_grant(actor, "casinos", "NONE")
    assert not cat.can_grant(actor, "themes", "READ_ONLY")
    assert cat.can_grant(actor, "employees", "ALL_CHANGES") is False
    assert cat.can_grant(actor, "employees", "ADDS_AND_UPDATES")


def test_serialize_roundtrip_deltas():
    deltas = {"casinos": "NONE", "themes": "READ_ONLY", "email: approval": "READ_ONLY"}
    blob = cat.serialize_permissions(deltas)
    assert "casinos: NONE" in blob
    assert "themes: READ_ONLY" in blob
    assert "email: approval" in blob
    parsed = cat.parse_permissions_blob(blob)
    assert parsed["casinos"] == "NONE"
    assert parsed["themes"] == "READ_ONLY"
    assert parsed["email: approval"] == "READ_ONLY"


def test_org_sensitive_areas_in_catalog():
    ids = {a.id for a in cat.PERMISSION_CATALOG}
    assert cat.EXPENSES_AREA in ids
    assert cat.EXPENSES_MASS_EDIT_AREA in ids
    assert cat.FINANCE_DASHBOARD_AREA in ids
    assert cat.ASSISTANT_AREA in ids
    assert cat.ASSISTANT_SECRETS_AREA in ids
    assert cat.has_area_read({"expenses": "READ_ONLY"}, cat.EXPENSES_AREA)
    assert not cat.has_area_write({"expenses": "READ_ONLY"}, cat.EXPENSES_AREA)
    assert cat.has_area_write({"dgs_expenses_mass_edit": "UPDATES_ONLY"}, cat.EXPENSES_MASS_EDIT_AREA)


def test_last_admin_count():
    people = [
        {
            "active": 1,
            "role_permissions": "employees: UPDATES_ONLY",
            "override_permissions": "",
        },
        {
            "active": 1,
            "role_permissions": "employees: READ_ONLY",
            "override_permissions": "",
        },
        {
            "active": 0,
            "role_permissions": "employees: ALL_CHANGES",
            "override_permissions": "",
        },
    ]
    assert cat.count_active_with_write(people, "employees") == 1


if __name__ == "__main__":
    test_parse_and_email_flags()
    test_merge_none_subtracts()
    test_overrides_from_effective()
    test_escalation_cap()
    test_serialize_roundtrip_deltas()
    test_org_sensitive_areas_in_catalog()
    test_last_admin_count()
    print("ok")
