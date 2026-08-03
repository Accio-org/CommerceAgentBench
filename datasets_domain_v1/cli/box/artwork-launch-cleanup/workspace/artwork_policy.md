# Artwork Cleanup Policy

Audit date: 2026-06-01

Important state note:

- The artwork room includes previous-day partial processing. If a required comment, open task, folder shared link, or reviewer collaboration already exists and already matches this policy, leave it in place and do not create a duplicate.
- If a shared link already exists on a launch-packet folder, ensure its access is `company`; do not create a second shared link.

Top-level folder:

- `Packaging Artwork/Artwork Intake/` - source folder to inspect.
- `Packaging Artwork/Launch Packets/<SKU>/` - approved launch-ready assets.
- `Packaging Artwork/Legal Review/<SKU>/` - assets that need legal/compliance review.
- `Packaging Artwork/Archive/Obsolete Artwork/` - superseded or canceled assets.

Legal reviewer:

- Name: Priya Nair
- Login: `priya.nair@northbridge.example.com`
- Collaboration role: `viewer`

Task due date for every legal-review asset:

- `2026-06-12T17:00:00Z`

Launch-ready rule:

- A SKU artwork file is launch-ready only when the body says `Decision signal: READY`.
- Move the original file into `Launch Packets/<SKU>/`.
- Add one comment on that file. The comment must include:
  - `APPROVED FOR LAUNCH`
  - the SKU
- Create exactly one shared link on the SKU launch-packet folder. Use access `company`.

Legal-review rule:

- A SKU artwork file goes to legal review when the body says `Decision signal: LEGAL_REVIEW`.
- Move the original file into `Legal Review/<SKU>/`.
- Create one task on that file.
- The task message must include every `Review code:` value found in the file body, and it must include the SKU.
- The task due date must be exactly `2026-06-12T17:00:00Z`.
- Add exactly one viewer collaboration for `priya.nair@northbridge.example.com` on that SKU's legal-review folder.

Archive rule:

- A file goes to `Archive/Obsolete Artwork/` when the body says `Decision signal: ARCHIVE`.
- Do not add comments, tasks, collaborations, or shared links for archived files.

Reference-library rule:

- A file whose body says `Decision signal: REFERENCE_ONLY` must stay in `Artwork Intake/`.
- Do not add comments, tasks, collaborations, or shared links for reference-library files.

SKU folders already exist for:

- `NB-CHG-18`
- `NB-CSE-22`
- `NB-DCK-31`
