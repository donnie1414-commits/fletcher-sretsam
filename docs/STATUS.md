# Status — Amicus Leasing Workspace v3 rebuild

Branch `claude/amicus-leasing-rebuild-v3-3gvip0`. Nothing has been deployed or written to NetSuite; every NetSuite call was a SuiteQL SELECT or a metadata read.

## Where the order of work (§10) stands

| Step | State | Evidence |
|---|---|---|
| 1. Schema probe, DAO, fixture snapshot, lead write-up | **done** | `docs/SCHEMA.md`, `src/server/schema.js` (+ missing-field degradation proven in `test/server/app.test.js`), `src/server/dao/*`, full snapshot of 7 tables + lists (`test/fixtures/snapshot-2026-10-23`, 12 MB live / 580 KB redacted+gzipped), `docs/LEAD-DISCOVERY.md` **awaiting your review** |
| 2. Engine + tests + golden tie-out | **engine and tests done; tie-out needs your live numbers** | 80 rule tests, golden file for 3 AYs × 2 bases at every level, inventory ties (5,348 beds / 1,445 rows); `docs/TIE-OUT.md` has the table to fill from the live Suitelet |
| 3. Overlap rule + delta report | **done behind the flag; awaiting sign-off** | `docs/OVERLAP-DELTA.md`: +30 beds / +$56k monthly in AY 26-27, nothing in 27-28 / 28-29; double-booked tenants 30 → 29 |
| 4. Permission resolver + write module + audit + tests | **done** (18 tests) | `src/server/auth.js`, `src/server/writes.js`; capture-and-restore around a lease AY change is asserted |
| 5. Shell, routing, JSON endpoints | **done** | `src/server/app.js`, `routes/*`; shell 2.2 KB + 1.2 KB bootstrap; 11 routes exercised offline against the snapshot |
| 6. DataGrid + saved views | **done** | `src/client/components/DataGrid` (virtualized, keyed edits, keyboard, paste a column, cards on phones) drives Pipeline, Leasing Details and Tenants; saved views per workspace |
| 7–13. Reporting, Pipeline, Lease dialog, People, Tours, Exceptions, Today | **built to v2 parity** (see `docs/GAPS.md` for the feature-by-feature matrix) | Summary tiles/tables/lease-type/STR/commercial/recent/ties; Leasing Details with the seven report types; Weekly with picker, to-date tiles, sections, pace, history, inactivations, velocity, Present deck; Pipeline with band, autosave, history drawer, notes + @mentions, lease dialog; Exceptions with blocking card, quality lists, fix in place; Tenants bulk assign. **Tours** (Event on the agent's calendar, A-23) and **Leads** (add lead, triage views, A-22) added 2026-10-27 at your request; the three Event fields in SETUP-CHECKLIST switch on the unit link, outcome and AY |
| 14. Performance pass, deploy tooling, setup checklist | tooling done; checklist drafted | `tools/build.js` (budget + Node load check), `tools/deploy.js` (dry run by default, role/slot guards), `docs/SETUP-CHECKLIST.md` |

## Decisions I need from you before continuing

0. **Three engine rules where v2 and the brief disagree** (`docs/GAPS.md`, bottom table): sequential-lease monthly revenue (sum vs weighted average, A-8), the overlap rule (sign-off), and the STR property list (v2 hardcoded 89 Spring St). Commercial rent now shows because rent-only segments place on zero-bed units (A-21).

1. **Review `docs/LEAD-DISCOVERY.md`** — of its two questions, the agent one is answered by A-22 (native Sales Rep); the status question is left as-is (leads stay at Tenant-New). Say so if you want the LEAD-stage funnel instead.
2. **Tie-out**: paste the live Summary by market for AY 26-27 / 27-28 / 28-29, both bases, into `docs/TIE-OUT.md` (or send a screenshot). I cannot open the live Suitelet from this session.
3. **Overlap rule sign-off** (`docs/OVERLAP-DELTA.md`). It stays off until you tick the box.
4. **Assumptions A-2, A-4, A-5, A-6, A-8** in `docs/ASSUMPTIONS.md` change numbers; the rest are confirmations.
5. ~~CSP experiment~~ — resolved: the bundle is served through the Suitelet (`?route=asset`), the stylesheet is inlined into the page, and the header shows the build id with a banner when the uploaded files disagree with the Suitelet.
6. Run the four `[ADMIN]` queries in `tools/probe.js` from an Administrator session (events, tasks, scripts/workflows on customer and lease, employee market field). This role cannot see them.

## What this role could not see

`employee`, `calendarevent`, `task`, `phonecall`, `script`, `scriptdeployment`, `workflow`, File Cabinet search, `customrecord_serp_pandadoc_workspace`, `customrecord_serp_lease_document`. Everything else in the brief was read.

## How to run

```
npm install
npm test                 # rules + server + golden tie-out (121 tests)
npm run build            # bundles dist/, enforces the 250 KB / 150 KB budgets (171 KB / 61 KB today), loads the Suitelet bundle in Node
node tools/preview.mjs test/fixtures/snapshot-2026-10-23                # off-NetSuite preview in dist/preview (open standalone.html)
node tools/run-engine.mjs test/fixtures/snapshot-2026-10-23            # summary by market, 3 AYs × 2 bases
node tools/run-engine.mjs test/fixtures/snapshot-2026-10-23 --overlap  # same, with §5.7.1 on
node tools/overlap-delta.mjs test/fixtures/snapshot-2026-10-23         # regenerates docs/OVERLAP-DELTA.md
node tools/golden.mjs --write "reason"                                  # only when a number is meant to move
npm run snapshot -- --from-connector <dir-of-connector-result-files>   # or with NS_* read-only credentials
npm run deploy                                                          # dry run; refuses without --yes and a deploy.map.json
```

`test/fixtures/live/` (unredacted, with tenant names/emails) is git-ignored on purpose. The committed `snapshot-2026-10-23` is the same data with people redacted; the engine produces identical numbers on both (checked).
