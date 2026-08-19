# Box CLI mock — golden-output oracle

Durable, **independent** golden reference for the Box CLI mock's human-readable
(`text`) and `--json` output. The smoke test (`../smoke_test.sh`, "Golden Output"
section) diffs the live mock's stdout byte-for-byte against these files.

## Regenerate

```bash
# from the box_cli mock root (bench_core/mock_services/box_cli/)
bun golden/gen_golden.mjs
```

Writes `<entity>.text` + `<entity>.json` for each representative entity. The
generator is deterministic (all values hardcoded from the seed — no clock, no
RNG), so re-running produces identical bytes unless you change `gen_golden.mjs`.

Only regenerate after a **deliberate** change to `seeds/default.sql` (the field
values) or to the documented upstream output contract. A surprise diff in the
smoke test means the mock's renderer drifted — fix the renderer, don't blindly
regenerate.

## Why this is independent (not tautological)

The Box CLI's `text` output is, per upstream `box/boxcli` @ `820cb9f` (v4.8.2),
`src/box-command.js:262-276`, literally:

```js
yaml.dump(formatObjectKeys(obj), { indent: 4, noRefs: true })
```

(cyan keys on a TTY only; `----- <Type> <id> -----` separators for collections).
The `text` format previously **drifted** because the mock hand-rolled YAML; it
was remediated to use the **real `js-yaml`** library (vendored at
`../node_modules/js-yaml`, v4.1.1, matching upstream's `^4.1.1`).

`gen_golden.mjs` derives the golden from real upstream primitives **only** — never
from the mock's renderer:

1. **Real `js-yaml`.** It does `import yaml from 'js-yaml'` (resolving to the same
   vendored `../node_modules/js-yaml` the real CLI uses) and calls `yaml.dump`
   itself. The text golden *is*, by construction, real-js-yaml output.
2. **Re-ported transform.** `formatKey` / `formatObjectKeys` / `KEY_MAPPINGS` are
   copied verbatim from `box-command.js` into the generator. It does **not**
   import the mock's `lib/output/text.js`.
3. **Seed-derived inputs.** The representative plain objects are built from values
   read straight out of `seeds/default.sql`; every field is annotated in
   `gen_golden.mjs` with its seed line and the documented object shape
   (`files.js fileToObj` / `folders.js folderToObj` / `users.js userToObj`).

So if anyone regresses `lib/output/text.js` or `lib/output/json.js` (reverts to
hand-rolled YAML, changes the indent, breaks the camelCase→snake→Title key
mapping, mishandles `null` / `[]` / nested collections, or drops the
trailing-newline contract), the smoke diff fails. The golden is the reference;
the mock must match it byte-for-byte — not the other way around.

- **text golden** = `yaml.dump(formatObjectKeys(rawObj), {indent:4, noRefs:true})`
  (verbatim, including js-yaml's single trailing `\n`). Non-TTY → no color, which
  matches the mock's piped/captured output exactly.
- **json golden** = `JSON.stringify(rawObj, null, 4)` + `\n` on the **raw**
  (snake_case) object — `--json` does not key-transform — mirroring the mock's
  `lib/output/json.js` + the `\n` `bin/box` appends on write.

## Fixtures

All values trace to `seeds/default.sql` (default seed; the smoke test feeds each
golden check a pristine, isolated copy of it).

| File | Mock command | Entity (seed) | Exercises |
|---|---|---|---|
| `file-30001.text` / `.json` | `box files:get 30001` | File *Q2-Budget-Report.xlsx* (line 23) | `KEY_MAPPINGS` (ID, SHA1, ETag), nested `parent` + `created_by`/`modified_by`/`owned_by` user objects, nested `path_collection` (object containing an array of objects), `null` (`shared_link`), empty array (`tags: []`), numeric `size` vs quoted numeric-string `id`/`etag` |
| `folder-20001.text` / `.json` | `box folders:get 20001` | Folder *Project Alpha* (line 17) | nested `parent`, `path_collection` with one ancestor (root), `item_collection` of 3 child files sorted by name, `size: 0`, empty `tags` |
| `user-10001.text` / `.json` | `box users:get` (defaults to "me" = first user) | User *Admin User* (line 10) | flat object, large integers (`space_amount`/`space_used`), `KEY_MAPPINGS` (ID) |

Note: the flat `user` object does not exercise indentation (a flat mapping has
nothing to indent), so indent regressions are caught by the **nested** `file` /
`folder` goldens (whose array entries sit at the indent:4 ×2 = 8-space level).
