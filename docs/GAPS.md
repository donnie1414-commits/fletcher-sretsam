# Feature parity: v2 Suitelet → v3 workspace

Source of truth for the left column: the two live scripts you uploaded (`Serp_SL_Lease_KpiReporting_Hierarchy_v2.js`, `Serp_Lease_KpiReporting_Hierarchy_LIB_v2.js`), read function by function. Status is against the preview built from the 2026-10-23 snapshot.

Legend: **✓ built** · **≈ built differently** (same information, new placement) · **✗ not built** (reason) · **🔒 needs a decision**

## Shell

| v2 | v3 | Status |
|---|---|---|
| Tabs Summary · Leasing Details · Weekly · Exceptions · Pipeline | Today · Pipeline · People · Reporting (Summary · Leasing Details · Weekly); Exceptions is the header badge + drawer | ≈ (§3.1 of the brief) |
| Criteria bar: AY, fund, market, basis; Run / Reset | Same four controls in the header; every change re-fetches, no Run button | ≈ |
| Market lock + viewer lock | Single resolver (deployment ∩ employee, blank = deny, admin bypass) | ✓ |
| Descriptions toggle (column notes rows) | Descriptions toggle on Summary tables and on Leasing Details | ✓ |
| Present mode (full-screen deck) | Present button on Weekly opens the deck; ▭ in the header enlarges figures | ✓ |
| Deep links (`#tab`, `#details/vacancy`) | Hash state carries screen, sub-screen, report type, AY, basis, fund, market, search | ✓ |

## Summary

| v2 | v3 | Status |
|---|---|---|
| Six tiles: Total Beds (properties, markets), Occupied (same date LY, LY final), Occupancy (pace tone), Vacant (fully / partly vacant units), Financial Occupancy, Total Revenue | Same six tiles, same comparison rows | ✓ |
| "Same date last year" pace note | Shown under the tiles with the LY as-of date | ✓ |
| By Market (Market ▸ Fund) and By Fund (Fund ▸ Market) expandable tables with LY and pace columns | `GroupTable`, same columns, CSV | ✓ |
| By Lease Type table | ✓ with share, pace, LY, financial occupancy | ✓ |
| Short-term rentals fold | ✓ (segment currently empty: `SEGMENT_PROPERTY_IDS.STR` is `[]`; v2 hardcoded 89 Spring St = id 39) | 🔒 confirm the STR list |
| Commercial / land / office fold (annual = monthly × 12) | ✓ — and a real fix: v2 and v3 both read these from the property type field, but v3 was excluding every commercial lease as `ZERO_BEDS`; rent-only segments now place on zero-bed units (A-21), so commercial rent shows | ✓ |
| New Lease Records (last 3 days, all AYs) | ✓ | ✓ |
| Ties check line | ✓ (people allow for sequential tenancies) | ✓ |

## Leasing Details

| v2 | v3 | Status |
|---|---|---|
| One tree, report types pick column groups: Occupancy & Revenue, Year over Year, Vacancy, Rent & Same-Store, Targets, Leases & Headcount, All | Same seven report types, same groups, on the virtualized DataGrid | ✓ |
| Vacancy report: only rows with vacant beds + four tiles | ✓ | ✓ |
| Same-store rent (100% leased both years, no excluded lease) | `rules/samestore.js`, same grain rule (unit, or property when a whole-house lease is placed) | ✓ |
| Targets: target, target/bed, actual vs target, vacant target rent, settle, prior-year rent/bed | ✓ (settle fields added to the DAO) | ✓ |
| Lease term columns (type / start / end / months), headcount, occupied by type | ✓ | ✓ |
| Find property, Expand/Collapse all, Export CSV (selected report's columns) | ✓ | ✓ |
| Empty parent properties dropped | ✓ | ✓ |
| Parent-city inheritance for blank City (`withParentCity`) | ✗ — the snapshot has no blank-City student property today; listed in the record-quality list instead (`MARKET_UNMAPPED`) | ✗ (no case) |

## Weekly

| v2 | v3 | Status |
|---|---|---|
| Week picker + ← → stepper | ✓ | ✓ |
| Three to-date tiles (year / month / week) with LY and prior-week, detail tables | ✓ | ✓ |
| Six KPI tiles (prior week, same week LY) | ✓ | ✓ |
| Undated-leases warning + reconciliation row | ✓ | ✓ |
| By market / by fund table with WoW, LY, beds leased, in process, revenue pace | ✓ with a By market / By fund switch | ✓ |
| Leases Sent This Week, Fully Executed This Week, Leases In Process (days, >21) — tiles, YoY strip, same-unit LY rent/bed | ✓ | ✓ |
| Leasing pace chart (LY continued past the selected week, AY start marker) | ✓ | ✓ |
| Week-over-week history (Last 8 / 26 / All) | ✓ | ✓ |
| Lease records made inactive this week (system notes) | ✓ built; **degrades**: the integration role cannot read `systemnote`, so the section says so (SETUP-CHECKLIST) | ✓ / 🔒 role permission |
| Velocity chart (counted leases by days from AY start, up to 3 prior AYs, type filter, both bases) | ✓ as a section on Weekly | ✓ |
| Deck: pre-leasing by future AY (side-by-side table) + per-AY activity and pace slides, keyboard nav | ✓ | ✓ |
| Dating rule: pro-forma by Lease Sent Date (fallback signed), executed by Lease Signed Date | adopted (A-14 updated); the previous v3 draft dated beds by signed date on both bases | ✓ |

## Pipeline

| v2 | v3 | Status |
|---|---|---|
| One row per leasable unit, beds tie to Summary | ✓ (asserted in tests) | ✓ |
| Stat band (units, beds, executed %, out unsigned, no stage, offline, below settle) + distribution bar + legend | ✓ plus "need action" | ✓ |
| Filters: market, stage, search, Needs action, Beds available, Mentions me | ✓ plus Below settle; market comes from the header | ✓ |
| Inline edits: stage, offered /bed, expected tenants, follow-up | ✓ (DataGrid, keyboard, paste a column) | ✓ |
| Autosave ~1 s after typing, one request in flight, chunks of 50, per-row errors, Save now / Revert, autosave toggle | ✓ | ✓ |
| Lease-owned stages read-only; blank-market rejection; market lock on save | ✓ (write module) | ✓ |
| Missing status row created on first save ("provisioning gap") | ✓ — `customrecord_ad_unit_ay_status` create is allowlisted with unit/AY/property/name as creation-only fields | ✓ |
| Leasing-history drawer per row: rent by AY (prior / current target / next target), settle floor, offered, beds available, occupied by, stage, days, lease, sent/signed, current tenants, expected, follow-up, notes, stage log | ✓ (`unithistory` route, fetched on open) | ✓ |
| Notes thread with @mentions, team picker, stamped with date and author | ✓ (`team` route; degrades to no picker when `employee` is not readable) | ✓ |
| Expected-tenants autocomplete | ≈ typed text; prior tenants shown in the drawer. A people search against the Tenants route is the natural next step | ≈ |
| Lease dialog: type (Unit default), market calendar dates, Oxford = no calendar, two-year, settle floor flag, bedroom picker defaulting to free bedrooms, whole house = sibling units, prior tenants for renewals, terms captured on the status row, created with NO status | ✓ (`shared/rules/leaseDialog.js` + `LeaseDialog.jsx`) | ✓ |
| Row cap 400 | not needed: server-side paging + virtualized grid | ≈ |
| "no status" and "yr 1/2" tags, settle-breach ▲, target vs signed | ✓ | ✓ |
| Export CSV | ✓ (every page) | ✓ |

## Exceptions

| v2 | v3 | Status |
|---|---|---|
| "Excluded from the leasing numbers" card by reason, ranked by cost, with lease tables | ✓ | ✓ |
| Tenants on more than one lease card | ✓ | ✓ |
| Lease Records / Tenant Records / Property & Unit Records sections with severity chips, search, CSV | ✓ (`rules/quality.js`) | ✓ |
| Lease quality: executed w/o signed date, in process w/o sent date, duration vs dates, blank status, signed in future / after AY end | ✓ (+ unknown status) | ✓ |
| Tenant quality: no tenants linked, count mismatch, double-booked (dup rent, markets), inactive tenant, no email | ✓ | ✓ |
| Property/unit record issues (orphan bedroom, zero beds, bed-count mismatch, parent missing, unmapped fund/city, duplicate / orphan targets) | ✓ | ✓ |
| Fix in place | ✓ set status, change type, relink, correct dates, change AY (Tenants captured and restored), inactivate — each shows before → after and re-runs | ✓ (new) |

## Engine rules that differ from v2 (each is flagged, none changed silently)

| Rule | v2 | v3 | Where |
|---|---|---|---|
| Sequential leases on one bed: monthly revenue | months-weighted average | **sum** (the brief §5.7.1: "revenue is the sum of both") | A-8 — 🔒 pick one |
| Collision rule | date-based overlap, no tolerance | legacy any-two-leases rule by default; §5.7.1 overlap with 7-day tolerance behind the flag | OVERLAP-DELTA.md — 🔒 sign-off |
| Lease term | not rounded up, default 12 | rounded up (11-month terms are 12 months of service) | A-… in ASSUMPTIONS |
| Zero-bed scope | excluded (`ZERO_BEDS`) for every segment | excluded for bed segments; **rent-only segments place** | A-21 |
| Weekly dating | by basis (sent / signed) | now the same | A-14 |

## Added after v2 parity (2026-10-27)

| Feature | Where | Notes |
|---|---|---|
| Schedule a tour | Today › Schedule tour; Pipeline › Tours column › Tour…; People › Leads › Tour… | NetSuite Event on the agent's calendar (A-23); several properties and units per tour (the first unit on the Event's unit field, the full list in the notes as `[units:…]`); update outcome from the same dialog |
| My calendar | header › Calendar; Today; Leads toolbar | opens NetSuite's calendar page (the tours are its events) |
| Add a lead | Today › + Add lead; People › Leads › + Add lead | creates the Lead Form's record (A-22); optional first tour in the same save; duplicate email guard |
| Leads segment | People › Leads | New (14 days) · No tour · No property · All; next/last tour, source, agent, school, asked-for; bulk property/AY; CSV |
| Leads with no next action | Today | leads in scope with no property and no tour |
| Lead statuses | automatic | Lead · New on create → Tour Scheduled when a tour is booked → Tour Completed on a Completed outcome (A-22) |
| @mention emails | Pipeline › Notes | a NetSuite email to each mentioned colleague with the note and a link back to the unit |
| Change log | header › Change log | the write audit record's list page (every hub write: who, when, old → new) |
| Add another lease | Pipeline › stage cell › Add another lease… | a further lease on a unit that already has one, only for months no lease holds; overlapping dates are refused (client and server) with the choice to end the other lease early or archive it |
| Re-check setup | banner › Re-check now | forgets the field/record probes so newly created fields are seen without waiting; a full page load does the same |

## Not carried over on purpose

- Server-rendered HTML tabs and the 1,400-row client table: replaced by JSON routes + one virtualized grid (§3.6, §4.1).
- `withParentCity`: no live case; surfaced as a record issue instead.
- Separate Vacancy tab hash (`#vacancy`): the Vacancy report type is deep-linkable as `rt=vacancy`.
