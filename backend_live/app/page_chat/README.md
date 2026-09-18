# Page Ask AI (Casinos pilot)

Script → Ollama → Cursor ladder. v1 stubs **deterministic runners** + **rule router**; Ollama `llama3.2:3b` on Slot Server wires in later. No Cursor in this path yet.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/page-chat/health` | Signed-in |
| GET | `/api/page-chat/contracts` | Verb JSON contracts |
| POST | `/api/page-chat/sessions` | `{ page, casino_id?, casino_name? }` → greeting + `session_id` |
| GET | `/api/page-chat/sessions/{id}` | Session meta |
| POST | `/api/page-chat/sessions/{id}/messages` | `{ content }` → clarify \| result \| unsupported |

**Auth:** any signed-in user (Casinos browse). New session per page visit.

## Test without UI

```bash
# after API up + auth token
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"page":"casinos","casino_id":"CT-00003","casino_name":"Lonestar"}' \
  http://127.0.0.1:9001/api/page-chat/sessions

# explicit verb (bypass stub NLP)
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"{\"verb\":\"performance_index\",\"args\":{\"casino_id\":\"CT-00003\",\"month_end\":\"2026-08-31\"}}"}' \
  http://127.0.0.1:9001/api/page-chat/sessions/{SESSION}/messages
```

## Verbs

`get_casino` · `project_status` · `project_breakdown` · `performance_index` · `explain_topic`

See `GET /api/page-chat/contracts` or `app/page_chat/contracts.py`.
