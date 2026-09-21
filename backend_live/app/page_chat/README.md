# Page Ask AI (Casinos pilot)

Script → Ollama → Cursor ladder. Deterministic runners + stub keywords; **Ollama `llama3.2:3b`** escalates when the stub would only clarify/unsupported. No Cursor in this path yet.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/page-chat/health` | Signed-in; includes Ollama ping |
| GET | `/api/page-chat/contracts` | Verb JSON contracts |
| POST | `/api/page-chat/sessions` | `{ page, casino_id?, casino_name? }` → greeting + `session_id` |
| GET | `/api/page-chat/sessions/{id}` | Session meta |
| POST | `/api/page-chat/sessions/{id}/messages` | `{ content }` → clarify \| result \| unsupported |

**Auth:** any signed-in user (Casinos browse). New session per page visit / casino context change.

## Env (Slot Server)

```bash
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_TIMEOUT_SEC=25
```

Compose adds `extra_hosts: host.docker.internal:host-gateway`.

## Test without UI

```bash
# after API up + auth token
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"page":"casinos","casino_id":"CT-00003","casino_name":"Lonestar"}' \
  http://127.0.0.1:9001/api/page-chat/sessions

# explicit verb (bypass NLP / Ollama)
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"{\"verb\":\"performance_index\",\"args\":{\"casino_id\":\"CT-00003\",\"month_end\":\"2026-08-31\"}}"}' \
  http://127.0.0.1:9001/api/page-chat/sessions/{SESSION}/messages
```

## Verbs

**Live:** `get_casino` · `project_status` · `project_breakdown` · `performance_index` · `explain_topic`

**Planned (contracts only — not in runners yet):** `last_project` · `scheduled_projects` · `list_report_templates` · `preview_report` · `send_report`

Also published: `report_templates`, `unmet_request_log` (side-effect schema for unsupported asks).

See `GET /api/page-chat/contracts` or `app/page_chat/contracts.py`.

## UI

`dgsappv1/assets/page-chat.js` + `page-chat.css` — desktop FAB, phone bottom bar. Mounted from Casinos (`casinos-v2`).
