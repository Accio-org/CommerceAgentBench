# NorthBridge Accessories — Vendor-Capability Sourcing Triage Policy

NorthBridge Accessories is sourcing components for a new **Smart Desk Charging Station**. The whole
component backlog lives in one Todoist project, **`Sourcing: Smart Desk Charging Station`**. A teammate
dumped every open sourcing line into the project's **`Backlog (to triage)`** section
without triaging it. Your job is to decide, for **every card currently in
`Backlog (to triage)`**, whether the **candidate vendor** on that card can actually
make the part to the stated **requirement**, and to route the card accordingly.

Each card has a short **title** (the component + the candidate vendor) and a **note**
(`todoist show <id>` shows it) containing two things:

- a **Requirement** — the manufacturing requirement for that component: the
  **process**, the **material** (and its grade/form), the **tolerance** or spec, and
  the **size**; and
- the candidate **Vendor capability statement** — the vendor's own description of
  what they do: their **processes**, the **materials** they run, their **size
  envelope** and the **tolerances** they hold.

## 1. The judgement: does the capability COVER the requirement?

A candidate vendor's capability **covers** a requirement only if **all** of the
following hold, read from the two texts on the card:

1. **Process** — the required manufacturing process is among the vendor's stated
   processes. A *different* process does **not** cover it, even if the material is
   the same.
2. **Material (and grade/form)** — the required material, in the required grade and
   form, is among the materials the vendor runs. A *different* material, grade or
   form does **not** cover it, even if the process is the same.
3. **Tolerance** — the vendor's stated tolerance is **at least as tight** as the
   requirement. A looser stated tolerance does **not** cover a tighter requirement.
4. **Size** — the part fits **within** the vendor's stated size envelope. A part
   that exceeds the envelope is **not** covered.
5. **Class / spec** — the required class or spec is within what the vendor states.

A capability written in **broader terms** **covers** the requirement when the
required process and material clearly fall **within** that broader family — even
with **no shared wording**.

**Judge by whether the stated capability actually covers the stated requirement —
not by whether the two texts share words.** Two statements can share process or
material words yet **not** cover (a different form, grade, tolerance, size or
missing step); and a capability can cover with **no** shared words (a broader
family that includes the requirement). When in doubt, reason it through from the
process, material/grade, tolerance, size and class stated on the card.

## 2. Routing (the deliverable)

For every card currently in `Backlog (to triage)`:

- **COVERED** — the candidate vendor's capability covers the requirement → move the
  card to the **`Ready to PO`** section. Do **not** add any label.
  ```
  todoist modify <id> --section-name "Ready to PO"
  ```
- **NOT COVERED** — there is a capability gap → move the card to the
  **`Re-source`** section **and** add labels for the gap:
  - always include **`capability-gap`**; and
  - also include every reason label that applies:
    **`process-gap`**, **`material-gap`**, **`tolerance-gap`**, **`size-gap`**,
    and/or **`spec-gap`**.
  ```
  todoist modify <id> --section-name "Re-source" --label-names capability-gap,process-gap
  ```

Reason-label taxonomy:

- `process-gap` — the vendor does not state the required production process,
  joining/finishing step, or part-form route.
- `material-gap` — the vendor does not state the required material, alloy, resin,
  substrate, plating/coating chemistry, or construction family.
- `tolerance-gap` — the vendor states a looser dimensional tolerance or trace/space
  capability than the requirement.
- `size-gap` — the part is outside the vendor's stated size, mass, or machine envelope.
- `spec-gap` — the vendor does not state a required formal class, safety rating,
  functional rating, certification, or performance standard.

Notes on the commands:

- Section names with a space or hyphen (e.g. `Ready to PO`, `Re-source`)
  must stay inside the quotes, exactly as written above.
- `--label-names` **replaces** a card's labels; pass comma-separated label names
  without leading `@`. Covered cards should have no labels. Not-covered cards
  should carry `capability-gap` plus all applicable reason labels and no extras.
- Leave nothing in `Backlog (to triage)`; do not close or delete any card.

## 3. Recording

All of your work is recorded directly in Todoist — each card's section and, where
there is a capability gap, its `capability-gap` label. There is no separate report
file to write.
