"""Dev view keeps the signed-in person and blocks writes. No database."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import auth_service  # noqa: E402
from app import permission_catalog as cat  # noqa: E402
from app import view_as  # noqa: E402


def test_view_as_is_not_grantable():
    actor = {"dgs_view_as": "READ_ONLY", "employees": "ALL_CHANGES"}
    assert cat.can_grant(actor, "dgs_view_as", "READ_ONLY") is False
    assert cat.can_grant(actor, "dgs_view_as", "NONE") is False
    assert "dgs_view_as" not in {a.id for a in cat.PERMISSION_CATALOG}


def test_reject_write_only_when_previewing():
    assert view_as.reject_write("POST", None) is None
    assert view_as.reject_write("GET", "EMP-000099") is None
    assert view_as.reject_write("POST", "EMP-000099")


def test_retain_private_override():
    existing = "expenses: ALL_CHANGES, dgs_view_as: READ_ONLY"
    rebuilt = cat.serialize_permissions({"expenses": "ALL_CHANGES"})
    kept = view_as.retain_private_overrides(existing, rebuilt)
    parsed = cat.parse_permissions_blob(kept)
    assert parsed["dgs_view_as"] == "READ_ONLY"
    assert parsed["expenses"] == "ALL_CHANGES"
    untouched = view_as.retain_private_overrides("slot_master: READ_ONLY", "")
    assert "dgs_view_as" not in cat.parse_permissions_blob(untouched)


def test_apply_uses_target_grants_and_keeps_actor(monkeypatch):
    def fake(eid):
        assert eid == "EMP-000099"
        return {
            "employee_id": "EMP-000099",
            "name": "New Hire",
            "email": "new@dynamicgamingsolutions.com",
            "role_name": "Technician",
            "role_permissions": "",
            "override_permissions": None,
        }

    monkeypatch.setattr(auth_service, "employee_by_id", fake)
    actor = {
        "employee_id": "EMP-000040",
        "name": "Paul C",
        "email": "paulc@dynamicgamingsolutions.com",
        "role": "Admin",
        "permissions": {"dgs_view_as": "READ_ONLY", "expenses": "ALL_CHANGES"},
        "tables": ["compinfo"],
    }
    out = view_as.apply(actor, "EMP-000099")
    assert out["email"] == "paulc@dynamicgamingsolutions.com"
    assert out["employee_id"] == "EMP-000040"
    assert out["name"] == "Paul C"
    assert "expenses" not in out["permissions"]
    assert out["can_view_as"] is True
    assert out["view_as"]["name"] == "New Hire"
    assert out["view_as"]["role"] == "Technician"
    public = view_as.public_user(out)
    assert "actor_permissions" not in public
    assert public["email"] == "paulc@dynamicgamingsolutions.com"


def test_apply_refuses_without_grant():
    actor = {
        "employee_id": "EMP-000068",
        "name": "Barry D",
        "email": "barryd@dynamicgamingsolutions.com",
        "permissions": {"expenses": "ALL_CHANGES"},
        "tables": [],
    }
    with pytest.raises(HTTPException) as raised:
        view_as.apply(actor, "EMP-000099")
    assert raised.value.status_code == 403
