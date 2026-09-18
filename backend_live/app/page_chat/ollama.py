"""Tier-2 Ollama router — map utterance → {verb,args} | clarify (no freeform SQL)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from app.page_chat.contracts import CASINO_VERBS, CLARIFY_LANES, EXPLAIN_TOPICS

logger = logging.getLogger("portfolio.page_chat.ollama")

_DEFAULT_BASE = "http://host.docker.internal:11434"
_DEFAULT_MODEL = "llama3.2:3b"


def enabled() -> bool:
    raw = (os.environ.get("OLLAMA_ENABLED") or "true").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return bool(base_url())


def base_url() -> str:
    return (os.environ.get("OLLAMA_BASE_URL") or _DEFAULT_BASE).strip().rstrip("/")


def model_name() -> str:
    return (os.environ.get("OLLAMA_MODEL") or _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def timeout_sec() -> float:
    try:
        return max(3.0, float(os.environ.get("OLLAMA_TIMEOUT_SEC") or "25"))
    except ValueError:
        return 25.0


def ping() -> dict[str, Any]:
    """Lightweight reachability for /health."""
    if not enabled():
        return {"ok": False, "enabled": False, "base_url": base_url(), "model": model_name()}
    url = f"{base_url()}/api/tags"
    try:
        with httpx.Client(timeout=3.0) as client:
            res = client.get(url)
        if res.status_code >= 400:
            return {
                "ok": False,
                "enabled": True,
                "base_url": base_url(),
                "model": model_name(),
                "error": f"HTTP {res.status_code}",
            }
        names = [m.get("name") for m in (res.json().get("models") or []) if isinstance(m, dict)]
        return {
            "ok": True,
            "enabled": True,
            "base_url": base_url(),
            "model": model_name(),
            "models": names[:12],
            "has_model": model_name() in names or any(str(n).startswith(model_name()) for n in names),
        }
    except Exception as exc:
        return {
            "ok": False,
            "enabled": True,
            "base_url": base_url(),
            "model": model_name(),
            "error": str(exc)[:200],
        }


def route(user_text: str, *, session: dict[str, Any]) -> dict[str, Any] | None:
    """Ask Ollama for a JSON route. Returns None on failure (caller keeps stub)."""
    if not enabled():
        return None
    prompt = _system_prompt(session)
    body = {
        "model": model_name(),
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 256},
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": (user_text or "").strip()},
        ],
    }
    url = f"{base_url()}/api/chat"
    try:
        with httpx.Client(timeout=timeout_sec()) as client:
            res = client.post(url, json=body)
        if res.status_code >= 400:
            logger.warning("ollama HTTP %s: %s", res.status_code, res.text[:300])
            return None
        content = ((res.json().get("message") or {}).get("content") or "").strip()
        parsed = _parse_route_json(content)
        if not parsed:
            logger.warning("ollama unparseable: %s", content[:300])
            return None
        return _normalize_route(parsed, session=session)
    except Exception as exc:
        logger.warning("ollama route failed: %s", exc)
        return None


def _system_prompt(session: dict[str, Any]) -> str:
    casino_id = session.get("casino_id") or ""
    casino_name = session.get("casino_name") or ""
    lanes = ", ".join(f'{o["id"]}={o["label"]}' for o in CLARIFY_LANES)
    topics = ", ".join(sorted(EXPLAIN_TOPICS))
    verbs = ", ".join(sorted(CASINO_VERBS))
    return (
        "You are the Casinos Ask AI router for Dynamic Gaming Solutions.\n"
        "Reply with ONLY one JSON object (no markdown).\n"
        "Shapes:\n"
        '  {"kind":"run","verb":"<verb>","args":{...}}\n'
        '  {"kind":"clarify","reply":"<short question>","options":null}\n'
        '  {"kind":"unsupported","reply":"<short reason>"}\n'
        f"Allowed verbs: {verbs}\n"
        "Args rules:\n"
        "- get_casino: args may be {} (session casino) or {casino_id}\n"
        "- project_status: {casino_id?, project_ref?, status_filter?: open|completed|all, limit?}\n"
        "- project_breakdown: {casino_id?, project_id} (PC-##### or IMS-#####)\n"
        "- performance_index: {casino_id?, month_end:YYYY-MM-DD} — month_end required\n"
        f"- explain_topic: {{topic_id}} one of: {topics}\n"
        "Never invent SQL, money, coin-in, win, or commission.\n"
        "Mapping hints:\n"
        "- GM, tribe, address, profile, contacts → get_casino\n"
        "- projects, FSR, floor work, jobs, installs, conversions, completed → project_status\n"
        "- serial/theme breakdown of a specific PC-/IMS- → project_breakdown\n"
        "- come in / received / processed / participation / month report → performance_index "
        "(only with month_end YYYY-MM-DD; else clarify which month)\n"
        "- what does X mean (project completed / report received / performance index) → explain_topic\n"
        "If the user is ambiguous about project vs performance 'come in', kind=clarify.\n"
        f"Clarify lane ids (optional hint): {lanes}\n"
        f"Session casino_id: {casino_id or '(none — ask user to select a casino)'}\n"
        f"Session casino_name: {casino_name or '(none)'}\n"
        "If the user names a *different* casino than the session (e.g. 'Havasu Landing' "
        "while session is Oaklawn), put casino_name in args (server resolves to CT-*). "
        "Do not force the session casino when another property is named.\n"
        "Prefer kind=run when a verb is clear. Prefer clarify over guessing month_end."
    )


def _parse_route_json(content: str) -> dict[str, Any] | None:
    if not content:
        return None
    try:
        data = json.loads(content)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None


def _normalize_route(raw: dict[str, Any], *, session: dict[str, Any]) -> dict[str, Any] | None:
    kind = str(raw.get("kind") or "").strip().lower()
    if kind not in {"run", "clarify", "unsupported"}:
        # Accept shorthand {verb, args}
        if raw.get("verb"):
            kind = "run"
        else:
            return None

    if kind == "run":
        verb = str(raw.get("verb") or "").strip()
        if verb not in CASINO_VERBS:
            return {
                "kind": "clarify",
                "reply": (
                    "I can help with this casino's profile, project status "
                    "(and a serial/theme breakdown), or whether a month's performance "
                    "has been processed. Which do you want?"
                ),
                "options": CLARIFY_LANES,
            }
        args = raw.get("args") if isinstance(raw.get("args"), dict) else {}
        clean: dict[str, Any] = {}
        for key in ("casino_id", "project_ref", "project_id", "status_filter", "month_end", "topic_id"):
            val = args.get(key)
            if val is None or val == "":
                continue
            clean[key] = str(val).strip()
        if "limit" in args:
            try:
                clean["limit"] = int(args["limit"])
            except (TypeError, ValueError):
                pass
        if not clean.get("casino_id") and session.get("casino_id"):
            clean["casino_id"] = session["casino_id"]
        return {"kind": "run", "verb": verb, "args": clean}

    reply = str(raw.get("reply") or "").strip() or (
        "Can you clarify what you need on this casino?"
    )
    if kind == "clarify":
        return {"kind": "clarify", "reply": reply, "options": CLARIFY_LANES}
    return {"kind": "unsupported", "reply": reply}
