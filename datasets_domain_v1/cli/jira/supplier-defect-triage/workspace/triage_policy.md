# NorthBridge Accessories — Supplier-Defect Triage Policy (Project PROJ)

NorthBridge Accessories sources consumer-electronics accessories from contract
manufacturers and tracks every incoming supplier-quality defect report as a Jira
issue in the **PROJ** ("Supplier Quality") project. New reports land in the
**To Do** column untriaged. This policy defines exactly how to triage them. Apply
it to **every issue currently in the To Do column** of PROJ.

Each report's **description** states the product SKU and supplier, the
**Severity** (Critical / Major / Minor), the number of **affected units**, the
**regulatory status**, the defect **symptom**, the **root cause**, and a
**story-point** estimate (and, for a few issues, a "Blocked by" line). The reports
were written by different people at different times, so the **same underlying
defect can be described in very different words** — read each description in full
and judge it on what it actually says, not on matching phrases.
(`jira issue list --raw` returns every description in one shot;
`jira issue view PROJ-3` shows one.)

## 1. Priority

First read the report's **affected units** and place it in a volume band:

- **High volume** — affected units **500 or more**.
- **Medium volume** — affected units **100 to 499**.
- **Low volume** — affected units **fewer than 100**.

(Use the **affected units**, not the production-run size.) Then set the priority
from this matrix of **Severity × volume band**:

| Severity \ Volume | High (≥ 500) | Medium (100–499) | Low (< 100) |
|---|---|---|---|
| Critical | Highest | High   | Highest |
| Major    | High    | Medium | Low     |
| Minor    | Medium  | Low    | Lowest  |

**Note the Critical row.** A Critical defect at **Low** volume is **Highest** —
*higher* than the same Critical defect at Medium volume. A critical harm defect
seen on even a handful of units is an early-field-failure signal and is treated as
top priority. Do not assume lower volume always means lower priority.

### Regulatory override

If a report's **Regulatory status is "reportable"**, ignore the matrix above and
set its priority from this override table instead (volume does **not** matter):

| Severity | Priority (if regulatory-reportable) |
|---|---|
| Critical | Highest |
| Major    | Highest |
| Minor    | High    |

A report whose Regulatory status is "not reportable" always uses the §1 matrix.

Set the priority with: `jira issue edit <KEY> --priority <Priority>`

## 2. Component

Classify each report into exactly one defect type **by judging the symptom** — what
actually happens and what its consequence is — and then set the matching component.
Decide from the **symptom**, not from the product, the supplier, or the regulatory
flag, and not from any single word:

- **appearance** — an appearance- or marking-only flaw: the product still works
  as intended and cannot injure anyone (e.g. a scratch or scuff, a colour or
  shade mismatch, a hairline crack that does not affect use, a misprinted or
  missing label or mark, coating that flakes off).
- **function** — the product fails to do its job, but cannot injure the user
  (e.g. won't charge, drops the connection, the screen blanks, keys chatter, a
  port is intermittent, it runs warm but stays within its rating).
- **harm** — a defect that could injure the user or damage property (e.g. a
  surface that gets hot enough to burn or scorch, a battery that swells or vents,
  an exposed live conductor, an electric shock, a jagged edge that can cut).

| Defect type | Component |
|---|---|
| appearance | Packaging |
| function | Engineering |
| harm | Compliance |

Judge by consequence, not vocabulary. The *same* word can fall in different
classes: a crack that still lets the product work normally is **appearance**, but
a crack that leaves an edge able to cut is **harm**; running "warm" within the
rated temperature is **function**, but getting hot enough to burn or scorch is
**harm**. A flaw that is regulatory-reportable is **not** automatically a harm
defect — a missing printed mark on a product that works and is otherwise fine is
an **appearance** flaw (it still uses the regulatory override in §1 for priority).

Set it with: `jira issue edit <KEY> --component <Component>`

## 3. Assignee

Assign each issue to the owner of its component (see also
`workspace/component_owners.csv`):

| Component | Owner |
|---|---|
| Packaging | mara.okafor@northbridge.example.com |
| Engineering | derek.tan@northbridge.example.com |
| Compliance | priya.nair@northbridge.example.com |

Assign it with: `jira issue assign <KEY> <owner-email>`

## 4. Duplicates

Some reports describe the **same defect** more than once, in different words. Two
reports are **duplicates only if they are the same underlying defect** — the same
physical failure with the same root cause. Judge this by **meaning**, because the
wording, the symptoms quoted, the affected-unit counts, and even the product can
all differ between two reports of one defect. In particular:

- **The same defect can appear on different SKUs.** A shared component, material
  batch, or production process can fail across several products; if two reports
  are the same failure with the same root cause, they are duplicates **even on
  different SKUs**.
- **Surface similarity does not make a duplicate.** Two reports that share a SKU,
  a supplier, or a symptom word but describe **different** failures with
  **different** root causes are **not** duplicates. (For example, two different
  problems on the same product, or two unrelated products that both merely "run
  warm" or both have "a port" issue, are not duplicates.)

For each duplicate pair, treat the **lower-numbered** issue as the canonical one
to keep, and for the **higher-numbered** issue:

1. Link it to the canonical issue as a **"Duplicates"** link:
   `jira issue link <HIGHER-KEY> <CANONICAL-KEY> "Duplicates"`
2. Close it by transitioning it to the **Done** state with `jira issue move`.
   Follow the project workflow — `jira issue move` rejects any transition the
   workflow does not allow and lists the valid next states, so move through the
   allowed states to reach Done.

Do **not** triage (priority/component/assignee) or commit the closed duplicate;
all triage for that defect stays on the canonical issue, which remains open and
**is** triaged per sections 1–3.

## 5. Commit issues to Cycle 7

The next delivery cycle, **Cycle 7**, has a capacity of **32 story
points**. Tag every issue you commit to Cycle 7 with the label **`cycle-7`**.
Select the committed issues with this procedure, exactly:

1. Consider only **non-duplicate** issues. An issue you closed as a duplicate is
   never committed.
2. Sort the candidates by **priority, highest first** (Highest → High → Medium →
   Low → Lowest). Within the same priority, order by **story points, fewest
   first**; break any remaining tie by issue number, lowest first.
3. Walk the sorted list keeping a running point total. For each issue: if adding
   its points keeps the total **at or under 32**, commit it and add
   its points to the total; if it would exceed 32, **skip it and keep
   checking** the remaining issues — a later, smaller issue may still fit.
4. **Blocker rule.** Some reports have a **"Blocked by <KEY>"** line. After the
   fill above, remove from the committed set any issue whose blocker is **not**
   itself in the committed set. Removing a blocked issue does **not** free
   capacity for new ones — do not re-run the fill or back-fill the freed points.

Tag a committed issue with: `jira issue edit <KEY> --label cycle-7`

## 6. Recording

All of your work is recorded directly in Jira (priorities, components, assignees,
duplicate links, transitions, and the `cycle-7` labels). There is no separate
report file to write.
