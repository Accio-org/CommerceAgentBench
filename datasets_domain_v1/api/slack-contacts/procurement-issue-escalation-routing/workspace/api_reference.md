# Mock API Reference

All POST requests must include this header:

```text
Authorization: Bearer local-mock-token
Content-Type: application/json
```

List endpoints return previews and may paginate with `next_cursor`; call the corresponding `/get` endpoint for full content. Some internal replies are generated only after you send an internal investigation message and then list messages again.


Base URLs:

- Slack-like API: `http://127.0.0.1:9110`
- Contacts API: `http://127.0.0.1:9103`

Slack endpoints:

- `POST /slack/messages` body: `{ "max_results": 30 }`
- `POST /slack/messages/get` body: `{ "message_id": "..." }`
- `POST /slack/send` body: `{ "to": "@internal-handle", "content": "..." }`
- `POST /slack/drafts/save` body: `{ "to": "@customer-or-internal", "content": "...", "reply_to_message_id": "..." }`
- `GET /slack/audit`

Contacts endpoints:

- `POST /contacts/search` body: `{ "query": "finance" }`
- `POST /contacts/get` body: `{ "contact_id": "CT-..." }` or `{ "slack_handle": "@..." }`
- `GET /contacts/audit`
