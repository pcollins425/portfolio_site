"""Technician casino scope. No database."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.casino_scope import (  # noqa: E402
    assigned_employee_id,
    blob_includes,
    columns_contain_any,
    is_technician,
    like_contains,
    sql_params,
    sql_predicate,
)


def test_only_technicians_are_scoped():
    tech = {"role": "Technician", "employee_id": "EMP-000105"}
    assert assigned_employee_id(tech) == "EMP-000105"
    assert assigned_employee_id({"role": "Sales", "employee_id": "EMP-000101"}) is None
    assert assigned_employee_id(None) is None


def test_dev_view_of_a_tech_is_a_technician():
    actor = {
        "role": "Admin",
        "employee_id": "EMP-000040",
        "view_as": {"employee_id": "EMP-000112", "role": "Technician"},
    }
    assert is_technician(actor) is True
    assert is_technician({"role": "Technician", "employee_id": "EMP-000105"}) is True
    assert is_technician({"role": "Sales", "employee_id": "EMP-000101"}) is False


def test_dev_view_uses_the_previewed_tech():
    actor = {
        "role": "Admin",
        "employee_id": "EMP-000040",
        "view_as": {
            "employee_id": "EMP-000112",
            "role": "Technician",
            "name": "Brandon A",
        },
    }
    assert assigned_employee_id(actor) == "EMP-000112"
    actor["view_as"]["role"] = "Manager"
    assert assigned_employee_id(actor) is None


def test_blob_matches_primary_and_licensed():
    blob = "1. EMP-000105, 2. EMP-000088"
    assert blob_includes(blob, "EMP-000105")
    assert blob_includes(blob, "EMP-000088")
    assert blob_includes("1. EMP-000105", "EMP-000105")
    assert not blob_includes(blob, "EMP-000010")
    assert not blob_includes(blob, "EMP-000106")


def test_sql_predicate_bounds_the_token():
    sql = sql_predicate("casinos")
    assert "casinos.techs LIKE %s" in sql
    assert sql_params("EMP-000105") == ("% EMP-000105", "% EMP-000105,%")


def test_name_match_escapes_like_wildcards():
    assert like_contains("100%") == "%100[%]%"
    sql, params = columns_contain_any(
        ["ims.lead_tech", "ims.assistant_techs"],
        ["Chelsie Wolf"],
    )
    assert sql.count("LIKE %s") == 2
    assert params == ("%Chelsie Wolf%", "%Chelsie Wolf%")
    assert columns_contain_any([], ["Chelsie Wolf"]) == ("1 = 0", ())
