"""Signed-in notes for the public documents page.

The static page explains the data model. This payload is appended under
those sections only after a session on this server. It describes how this
account's records are set up.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/account-guide", tags=["account-guide"])

_SECTIONS: dict[str, list[str]] = {
    "machine": [
        "On this account the asset is the serial in Assets. Cabinet and theme sit on that same record. The asset hub is the one machine. Slot Master, projects, and performance point at that serial.",
    ],
    "floor": [
        "The floor is Slot Master. A row is one placement: that asset at a property until a removal or a conversion closes it. Casinos is the property. Warehouse is a cabinet that is off the floor.",
        "When the machine count and the billed count differ, machines are the playable placements at month-end. Billing is the participation lines expected for that month.",
    ],
    "month": [
        "The month is the participation report for each property, joined to the placements that were there. Executive is coin-in, actual win, and commission, plus the trailing year. Billing coverage is expected lines against invoiced lines.",
        "A reporting share well below the prior month means reports for that month are still arriving.",
    ],
    "job": [
        "A project is the install, removal, move, or conversion. Projects holds the calendar and the machines on the job. That job is why the next month’s floor changed. A project with no start and end does not count as open work on the executive pulse.",
    ],
    "service": [
        "Service on a unit is kept in eMaint. This application shows the asset, the parts that cabinet takes, and the warehouse the cabinet is sitting in. A repair stays on the unit. An install, removal, move, or conversion is a project.",
    ],
    "customer": [
        "Casinos is the property. Contracts is the agreement on the machines. Contacts and deals come from HubSpot and show on the casino. A deal that changed the floor should point at a project. If it does not, the commercial picture and the floor have split.",
    ],
    "screens": [
        "Trust Slot Master for what is on the floor, Executive for the month, Projects for why the floor changed, Assets and Parts for the unit, and Casinos with Contracts for who it sits under.",
    ],
}


@router.get("")
def account_guide(
    _user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Notes for the signed-in account. Any signed-in user of this server."""
    return {"sections": _SECTIONS}
