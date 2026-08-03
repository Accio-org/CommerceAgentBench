# Mock API Reference — alibaba_publish (CLI variant)

Base URL: `http://127.0.0.1:3000`

All `/api/cli/*` requests must include:

```text
Authorization: Bearer local-mock-token
```

POST/PUT `/api/cli/submit` is `multipart/form-data`; other endpoints use JSON.

## Endpoints

### `POST /api/cli/session`
Opens (or fetches) the active session. Returns:

```json
{ "sessionId": "<uuid>", "status": "active", "createdAt": "<iso>" }
```

The same `sessionId` is reused if you call it again; the harness watches
`/api/sessions` for `status=submitted` to trigger early termination, so make
sure your final submit flips that status.

### `GET /api/cli/fields`
Returns the full ordered field schema as an array:

```json
[
  {"name": "category", "label": "类目", "type": "select", "section": "basic", "required": true, "options": ["..."]},
  {"name": "image_1", "label": "主图", "type": "file", "section": "media", "required": true},
  ...
]
```

Use this to discover every field name, type (`text` / `select` / `radio` /
`checkbox` / `dropdown_tree` / `json` / `html` / `file` / `number`), allowed
options for closed-set fields, and which fields are required.

### `POST /api/cli/submit`
Submit the form. Required header: `X-Session-Id: <sessionId>`.

Body is `multipart/form-data`:
- Text / enum / JSON / HTML fields go as plain form fields (e.g. `saleMode=batch`).
- File fields (`image_1`, `image_2`, ..., `video`) go as file parts; the
  uploaded filename is preserved.

On success: 200 with `{ sessionId, fieldsSaved, fields: [...] }` and the
session is marked `submitted` so the harness terminates the agent.

Closed-set validation (anti-cheat) runs server-side; invalid enum values
return 400 with an `errors` array — fix the value and re-submit.

## Example (curl)

```bash
TOKEN='local-mock-token'
BASE='http://127.0.0.1:3000'
SID=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/session" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/fields" > fields.json

curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Session-Id: $SID" \
  -F 'productTitle=LED Bulb 9W A60' \
  -F 'saleMode=batch' \
  -F 'priceUnit=USD' \
  -F 'image_1=@files/images/main_product.jpg' \
  "$BASE/api/cli/submit"
```
