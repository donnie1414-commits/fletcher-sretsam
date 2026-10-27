# Setup checklist — what must exist in NetSuite before the workspace runs

Internal ids are exact. **When you create a custom field or record NetSuite prefixes `custrecord` / `custentity` / `custevent` / `customrecord` for you — type the id starting at the underscore.** Example: to get `custrecord_ad_uas_lease_terms`, type `_ad_uas_lease_terms` in the ID box.

## A. Files (three, plus two for the experiment)

Telling them apart on sight: the Suitelet file starts with `/** @NApiVersion 2.1 @NScriptType Suitelet` and the word `define(`; the client bundle is one minified line starting `(()=>{`; the stylesheet starts `:root{`. `dist/MANIFEST.json` has the SHA-256 and byte size of each; compare after upload (File Cabinet shows size).

| Local file | Role | File Cabinet folder | Script record |
|---|---|---|---|
| `dist/amicus_leasing_sl.js` | **Suitelet entry** (the only file that goes on a Script record) | SuiteScripts/AmicusLeasing | Suitelet "Amicus Leasing Workspace", deployment released to the leasing roles |
| `dist/amicus_leasing_app.js` | client bundle | SuiteScripts/AmicusLeasing | none — referenced by script parameter |
| `dist/amicus_leasing_app.css` | client styles | SuiteScripts/AmicusLeasing | none — referenced by script parameter |
| `tools/csp-probe/al_csp_probe_sl.js` + `al_csp_probe.js` | CSP experiment (temporary) | anywhere | Suitelet "AL CSP probe" with parameter `custscript_al_csp_probe_file` = file id of `al_csp_probe.js` |

Never put `amicus_leasing_app.js` on the Suitelet script record (§3.3). `npm run deploy` refuses that mapping.

## B. Script parameters on the Suitelet

| Id | Type | Value |
|---|---|---|
| `custscript_al_client_js` | Integer | File Cabinet internal id of `amicus_leasing_app.js` |
| `custscript_al_client_css` | Integer | File Cabinet internal id of `amicus_leasing_app.css` |
| `custscript_al_overlap_rule` | Checkbox | off until `docs/OVERLAP-DELTA.md` is signed off |
| `custscript_lkr_markets` | Free-form text or multi-select | market names, comma separated (existing parameter from the market lock) |
| `custscript_lkr_user_lock` | Checkbox | on (existing) |

## C. List value

| List | Add value | Why |
|---|---|---|
| `customlist_ad_leasing_stage` | **In Negotiations** (exact text) | §5.4; the server matches stages by label, so any id works. Retire nothing. |
| `customlist_ad_leasing_stage` | **Lease Revisions** (exact text) | the board's "Revisions…" action sets it and opens the lease record; the lease User Event takes the stage back on the next sent/signed event. Until the value exists the action reports "has no value in the leasing-stage list yet". |

## D. Fields

| Record | Field id | Type | Notes |
|---|---|---|---|
| Unit Leasing Status (`customrecord_ad_unit_ay_status`) | `custrecord_ad_uas_lease_terms` | Long Text | JSON shadow of agreed terms; absent today (A-19) — the app degrades without it |
| Event (`calendarevent`) | `custevent_ad_tour_unit` | List/Record → Units/Bedrooms | the tour link (§5.6) |
| Event | `custevent_ad_tour_outcome` | List → `customlist_ad_tour_outcome` | values: Scheduled, Completed, No-show, Cancelled, Leased |
| Event | `custevent_ad_tour_ay` | List/Record → Academic Year | which AY the tour counts toward |
| Employee | `custentity_lkr_markets` | Multiple Select (city/market names) | existing per the brief; confirm (A-20) |

The three Event fields switch on the full tour feature (unit link on the Pipeline, outcome, AY). Until they exist the app still schedules tours: the Event is created with the property and unit in its Location and the save reports which fields were left out. Create the list `customlist_ad_tour_outcome` first (values exactly as above), then the three fields; tick *Show in list* and give the leasing roles access on each.

**Role permissions for tours and leads** (Setup › Users/Roles › Manage Roles › the leasing roles): *Lists › Events* — Full (the tour is an Event organised by the agent, so it must be creatable and editable); *Lists › Customers* — Create (the hub adds leads the way the Lead Form does); *Lists › Employee Record* — View (to pick another agent as the organiser; without it the picker offers only yourself). The CRM feature must be on (it is).

## E. Records

**Saved views** `customrecord_ad_saved_view` (§4.2): fields `custrecord_ad_sv_owner` (List/Record → Employee), `custrecord_ad_sv_workspace` (Free-form text), `custrecord_ad_sv_name` (Free-form text), `custrecord_ad_sv_json` (Long Text), `custrecord_ad_sv_default` (Checkbox), `custrecord_ad_sv_shared_markets` (Free-form text). Access: leasing roles create/edit own.

**Write audit** `customrecord_ad_write_audit` (§5.9): `custrecord_ad_wa_who` (List/Record → Employee), `custrecord_ad_wa_when` (Date/Time), `custrecord_ad_wa_rectype` (text), `custrecord_ad_wa_recid` (text), `custrecord_ad_wa_field` (text), `custrecord_ad_wa_before` (Long Text), `custrecord_ad_wa_after` (Long Text), `custrecord_ad_wa_change_id` (text; the hub looks it up before writing, no unique setting needed). Until it exists, writes are logged to the script execution log and the UI shows "audit: log-only".

## F. Per-click order

1. Create the list value (C) and the fields (D) and records (E). Reload the Suitelet; the bootstrap's `degraded` list should be empty.
2. Upload the three files (A). Note the three internal ids.
3. Create the Suitelet script record from `amicus_leasing_sl.js`; add the parameters (B); set the two file ids.
4. Deploy to the leasing roles; open it. The stub page prints your scope and the degradation list.
5. Run the CSP probe once (A, last row) if step 4 shows "Client bundle not configured" despite the ids being set.
6. Copy the ids into `deploy.map.json` (template printed by `npm run deploy`) so future uploads are verified by hash.
