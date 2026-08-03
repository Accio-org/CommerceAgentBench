# Mock API Reference — DTC Campaign Platform (CLI variant)

Base URL: `http://127.0.0.1:3000`

All `/api/cli/*` requests must include:

```text
Authorization: Bearer local-mock-token
```

POST `/api/cli/campaign/submit` is `multipart/form-data`; other endpoints use JSON.

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
  {"name": "campaignName", "label": "活动名称", "type": "text", "section": "basic", "required": true},
  {"name": "campaignType", "label": "活动类型", "type": "select", "section": "basic", "required": true, "options": ["flash_sale", "clearance", "seasonal", "bundle"]},
  {"name": "banner_1", "label": "主Banner", "type": "file", "section": "media", "required": true},
  ...
]
```

Use this to discover every field name, type (`text` / `select` / `radio` /
`checkbox` / `json` / `file` / `number`), allowed options for closed-set
fields, and which fields are required.

### `POST /api/cli/campaign/submit`
Submit the campaign configuration. Required header: `X-Session-Id: <sessionId>`.

Body is `multipart/form-data`:
- Text / enum / JSON fields go as plain form fields (e.g. `campaignType=flash_sale`).
- File fields (`banner_1`, `banner_2`, ..., `banner_5`) go as file parts; the
  uploaded filename is preserved.

On success: 200 with `{ sessionId, fieldsSaved, fields: [...] }` and the
session is marked `submitted` so the harness terminates the agent.

Closed-set validation (anti-cheat) runs server-side; invalid enum values
return 400 with an `errors` array — fix the value and re-submit.

## Field Types

| Type | Format | Example |
|------|--------|---------|
| text | Plain string | `"ChronoVibe Summer Flash 2026"` |
| select | One of allowed options | `"flash_sale"` |
| number | Numeric string, 2 decimal places | `"399.00"` |
| json | JSON-serialized string | `"[{\"phase\":\"early_access\",...}]"` |
| file | multipart file upload | `banner_1=@path/to/file.png` |

## Closed-Set Field Options

| Field | Allowed Values |
|-------|---------------|
| campaignType | `flash_sale`, `clearance`, `seasonal`, `bundle` |
| discountType | `tiered_time`, `flat`, `bogo`, `threshold` |
| stockReserveMode | `hard_reserve`, `soft_reserve`, `none` |
| currency | `USD`, `EUR`, `GBP`, `JPY`, `CNY` |

## Example (curl)

```bash
TOKEN='local-mock-token'
BASE='http://127.0.0.1:3000'
SID=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/session" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/fields" > fields.json

curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Session-Id: $SID" \
  -F 'campaignName=My Campaign' \
  -F 'campaignType=flash_sale' \
  -F 'basePrice=199.00' \
  -F 'banner_1=@files/assets/BANNER_001.png' \
  "$BASE/api/cli/campaign/submit"
```
