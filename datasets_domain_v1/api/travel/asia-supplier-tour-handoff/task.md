I'm a senior travel auditor at Helios Sourcing Group. A junior coordinator, Priyanka, has prepared a 12-day Asia supplier-tour itinerary for a 5-person team (Shenzhen → Yiwu → Ho Chi Minh City → Bangkok) and compiled her selections into an HTML brief (`workspace/itinerary_brief.html`), ready to send the booking instructions to the team. **Some of her claims are wrong.** Before the bookings go out I need to identify every wrong claim, classify it by error type, locate it by leg, and provide the correct value.

The sources under `workspace/`:

| File | Source kind | Authority |
|---|---|---|
| `itinerary_brief.html` | Junior coordinator's draft (the artifact under audit) | **Non-authoritative** — this is what I'm checking. Treat its claims as suspect. |
| `corporate_travel_policy.pdf` | Helios Group's binding travel policy (4 pages, signed by Finance + HR) | **Authoritative** for budget caps, contracted-hotel allowlist, accessibility, dietary, cancellation, and flight-arrival-window rules |
| `team_emails/01_intro.eml` | Coordinator's intro email summarising team logistics | **Authoritative** for stated rules (e.g. co-location requirement) |
| `team_emails/02_alex_constraints.eml` | Sales lead Alex's email itemising team preferences | **Authoritative** for individual team-member needs (read the full message INCLUDING the signature line) |
| `team_emails/03_finance_pushback.eml` | Finance's written override of the original budget | **Authoritative** — per policy PDF page 4, finance written overrides supersede previous limits |
| `team_emails/04_client_dietary.eml` | Bangkok client's dietary request | **Authoritative** for client-side requirements |
| `client_meetings.ics` | iCalendar with the 4 client meetings (each carries an explicit `TZID`) | **Authoritative** for meeting times and time zones |
| `flight_options.pdf` | Flight options table (3 candidates per leg) | **Authoritative** for arrival/departure times — note the PDF is image-rendered, you may need vision/OCR |
| `charts/leg_schedule_overview.png` | Visual schedule overview from Priyanka | Part of the brief — claims in pixel labels are non-authoritative just like the HTML |
| `charts/team_seat_assignment.png` | Visual team seat assignment from Priyanka | Same as above |

The SerpAPI google_hotels endpoint is only reachable at `http://127.0.0.1:4501/api`; discover its surface via `GET /api/help` and `GET /api/datasets`. Each dataset corresponds to one search Priyanka ran during planning, and the endpoint returns SerpAPI google_hotels JSON verbatim (`{search_metadata, search_parameters, search_information, properties[], ads[], brands[], serpapi_pagination}`). **Treat that data as authoritative for property attributes** (rate, amenities, excluded_amenities, nearby_places, reviews_breakdown, hotel_class, prices). When two trusted sources conflict, the more specific / more recent one wins (e.g., a written finance override email beats the policy PDF's earlier blanket cap).

## Disambiguation rules (must follow)

1. When a property's `amenities[]` array and `excluded_amenities[]` array describe contradictory facts about the same feature (e.g. `amenities` contains `"Free Wi-Fi"` while `excluded_amenities` contains `"No Wi-Fi"`), treat `excluded_amenities` as authoritative. The property does NOT have that feature.
2. When the brief's section header asserts a sum is "all-in" / "including taxes and fees" / "post-tax", verify the displayed total uses `total_rate.lowest` (post-tax) — not `total_rate.before_taxes_fees` (pre-tax). If the section header is ambiguous, defer to the corporate travel policy's billing convention (page 4).
3. When two trusted sources conflict on a numeric limit (e.g., policy PDF says $300/night but the finance email says $250/night for the same leg), apply policy PDF page 4's override clause: the more recent written override supersedes; the **stricter** of the two limits applies.

## What to find

Every wrong claim Priyanka makes in the HTML brief (and in the embedded charts). Each error fits into ONE of these types:

| `error_type` (enum) | Meaning |
|---|---|
| `policy_violation` | The chosen hotel violates a corporate-policy budget, contract, or rule |
| `accessibility_mismatch` | Selected hotel does not accommodate a documented team-member's accessibility need |
| `time_window_violation` | A claimed meeting/dinner/event time is impossible given trusted source's schedule (typically a time-zone error) |
| `arithmetic_error` | A sum, count, or numeric aggregate in the brief is incorrect (off by more than rounding) |
| `cross_source_inconsistency` | The brief picked a property whose own data is internally contradictory; the disambiguation rule above shows the property should not have been chosen |
| `dietary_unaccommodated` | Selected hotel area lacks dietary options the client/team explicitly requires |
| `co_location_failure` | Team is split across multiple hotels for a leg in violation of a stated rule |
| `non_contracted_hotel` | Selected hotel is not on the contracted-hotel allowlist for that city |
| `cancellation_floor_violation` | Selected room rate violates the policy's cancellation-grace floor |
| `flight_arrival_mismatch` | Selected flight violates a stated arrival-time / window rule, OR conflicts with downstream meeting timing |

Each error is anchored to exactly ONE `leg_id`. Use the `leg_id` values the brief assigns to each section (verbatim string).

Not every suspicious-looking claim is an error — some unusual claims may still comply with the policy after I reconcile the sources. The `findings` list should contain only claims I can support as genuinely wrong; avoid both over-reporting compliant claims and missing real errors.

## `outputs/audit_findings.json`

```json
{
  "findings": [
    {
      "finding_id": <integer: any unique informational id, e.g. 1>,
      "error_type": "<string: one of the 10 enum values above, case-insensitive, e.g. 'policy_violation'>",
      "leg_id": "<string: the leg's id verbatim from the brief, lowercase, e.g. 'bangkok-night-1'>",
      "claim_excerpt": "<string: short quote from the brief, for traceability, e.g. 'Hotel X at $400/night'>",
      "correct_value": <type depends on error_type, see table below; case-insensitive for strings; reasonable precision for numbers>
    }
  ]
}
```

`correct_value` type per `error_type`:

| error_type | `correct_value` type |
|---|---|
| `policy_violation` | number (the corrected USD limit or USD amount) |
| `arithmetic_error` | number (the corrected total in USD) |
| `time_window_violation` | number (the correct local time as minutes-since-midnight in the meeting's TZID, e.g. 21:00 → 1260) |
| `accessibility_mismatch` | string (the policy-compliant alternative hotel name, verbatim from the endpoint) |
| `cross_source_inconsistency` | string (the alternative hotel name that should have been chosen, verbatim from the endpoint) |
| `dietary_unaccommodated` | string (the alternative hotel name that satisfies the dietary rule, verbatim from the endpoint) |
| `co_location_failure` | string (the single hotel name where the team should be co-located, verbatim from the endpoint) |
| `non_contracted_hotel` | string (a contracted-hotel name from the policy allowlist, verbatim) |
| `cancellation_floor_violation` | number (the policy-mandated minimum cancellation grace in hours; derive from the relevant policy section) |
| `flight_arrival_mismatch` | string (the correct flight code, verbatim from `flight_options.pdf`) |

To get started:

```bash
curl -s http://127.0.0.1:4501/api/help
curl -s http://127.0.0.1:4501/api/datasets
```
