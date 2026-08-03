# Mock API Reference — projector publish (CLI variant)

Base URL: `http://127.0.0.1:3000`

All `/api/cli/*` requests must include:

```text
Authorization: Bearer local-mock-token
```

POST `/api/cli/submit` is `multipart/form-data`; other endpoints use JSON.

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
  {"name": "category", "label": "类目", "type": "select", "section": "basic", "required": true},
  {"name": "image_1", "label": "主图", "type": "file", "section": "media", "required": true},
  ...
]
```

Use this to discover every field name, type (`text` / `select` / `number` /
`json` / `file`), and which fields are required.

### `POST /api/cli/submit`
Submit the form.

Body is `multipart/form-data`:
- Text / number / select / JSON fields go as plain form fields (e.g. `saleMode=Cross-border Direct`).
- File fields (`image_1`, `image_2`, ...) go as file parts; the
  uploaded filename is preserved.

On success: 200 with `{ sessionId, fieldsSaved, fields: [...] }` and the
session is marked `submitted` so the harness terminates the agent.

Closed-set validation (anti-cheat) runs server-side; invalid enum values
return 400 with an `errors` array — fix the value and re-submit.

## Closed-Set Field Options

| Field | Allowed Values |
|-------|---------------|
| category | `Consumer Electronics > Projectors & Accessories > Portable Projectors`, `Consumer Electronics > Projectors & Accessories > Tripods & Mounts`, `Consumer Electronics > Projectors & Accessories > Screens`, `Bags & Cases > Electronics Cases > Projector Cases` |
| saleMode | `Domestic Shipping`, `Cross-border Direct`, `Cross-border Bonded` |
| productGroup | `Consumer Electronics`, `Bags & Cases`, `Home & Garden` |
| saleType | `Per Unit`, `Per Piece`, `Per Set`, `Per Lot` |
| priceUnit | `Set`, `Piece`, `Pair`, `Unit`, `Lot` |
| priceMode | `ladder`, `fixed`, `negotiable` |
| fobType | `FOB Shenzhen`, `FOB Ningbo`, `FOB Shanghai`, `FOB Guangzhou` |
| productVisible | `yes`, `no` |
| descType | `custom`, `template`, `smart_edit` |

## Example (curl)

```bash
TOKEN='local-mock-token'
BASE='http://127.0.0.1:3000'
SID=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/session" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/cli/fields" > fields.json

curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -F 'category=Consumer Electronics > Projectors & Accessories > Portable Projectors' \
  -F 'saleMode=Cross-border Direct' \
  -F 'productTitle=NovaCast P5 Pro Portable Projector ...' \
  -F 'priceUnit=Set' \
  -F 'image_1=@files/assets/IMG_20260610_001.jpg' \
  "$BASE/api/cli/submit"
```
