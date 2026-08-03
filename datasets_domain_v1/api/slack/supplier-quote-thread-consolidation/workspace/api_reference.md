# Mock API Reference

All POST requests must include this header:

```text
Authorization: Bearer local-mock-token
Content-Type: application/json
```

List endpoints return previews and may paginate with `next_cursor`; call the corresponding `/get` endpoint for full content.


Base URL:

- Slack-like API: `http://127.0.0.1:9110`

Endpoints:

- `POST /slack/messages` body: `{ "channel": "#rfq-stainless-bottle", "max_results": 30 }`
- `POST /slack/messages/get` body: `{ "message_id": "..." }`
- `GET /slack/audit`

Do not call `/slack/send` or `/slack/drafts/save` for this task.
