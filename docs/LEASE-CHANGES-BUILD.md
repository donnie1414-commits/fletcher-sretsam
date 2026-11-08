# Lease changes: build sheet

This is the running list of everything the lease-change workflows need. It is updated whenever something is built, verified or revised; the log at the bottom says what changed and when. The plan it implements is the "Lease Change Workflows" page (one Change lease request, four mechanisms, the lease's state decides the path).

**Status key.** `built` = code written and tested here · `to build` = a NetSuite object someone has to create · `ask Salora` = needs the PandaDoc developers · `decision` = needs Amicus · `verified` = checked working in the sandbox.

## 1. How it works

The agent opens **⇄ Change lease** and ticks **everything that applies**: tenant(s) leaving (optionally moving to another of our leases), tenant(s) joining, rent changes, dates change, provisions added, group moves to a different house or unit, lease ends early / whole group released. The hub routes the ticks to one of the nine workflows (`routeConditions` in `leaseChangeMeta.js`) and shows "Routes to …" before Preview:

| Ticked | Routes to |
|---|---|
| Lease ends early (alone; cannot be combined) | 6 · Entire group released |
| Group moves (with any leaving / joining / rent) | 1 · Group moves to a different house |
| Leaving + "moving to another of our leases" | 2 · One tenant moves to another lease |
| Leaving + joining | 3 · Tenant replaced |
| Leaving (with or without rent / dates / provisions) | 5 · One tenant released |
| Joining (with or without rent / provisions) | 7 · Tenants added |
| Only rent / dates / provisions | 4 · Terms renegotiated (8 · mid-term adjustment is the same workflow) |

Scenario 9 (tenant added after sending) is "Joining" on an unsigned lease. The amendment stores both the ticks and the workflow they routed to.

| Lease state | Path | What happens |
|---|---|---|
| No status, never sent | **Edit** | The hub changes the lease directly and logs the change as an Applied amendment. |
| In Process (sent, unsigned) | **Revise** | Same, plus the stage moves to Lease Revisions and the agent is told to void the PandaDoc documents and press Send Contract again. No approval. |
| Fully Executed | **Amend** | The hub files a Lease Amendment at **Pending approval**. Nothing on the lease changes. The approval workflow moves it to Approved → Sent for signature → Signed; at Signed the **Apply Lease Amendment** script runs the stored plan. |

Mechanisms when applied: **Supersede** (old lease ends the day before the effective date, a new lease starts that day, linked by Supersedes, group type Amendment), **Terminate** (ends early with a reason), **Cancel** (not started yet: inactivated, never deleted), **Transfer** (old lease ends, new lease at the other house, group type Transfers), **Assignment** (same terms, roster change on the signed lease; the amendment row records who left and who joined).

The plan is stored on the amendment (`custrecord_ad_am_plan`), so what is applied is exactly what was approved. Applying is idempotent: a half-finished apply can be run again and skips the steps already done.

## 2. Code (built here, delivered as files, never in GitHub)

| File | Upload to | What it is | Status |
|---|---|---|---|
| `amicus_leasing_sl.js` | SuiteScripts/AmicusLeasing (replace) | The hub Suitelet with the new `leasechange` route | built |
| `amicus_leasing_app.js`, `amicus_leasing_app.css` | SuiteScripts/AmicusLeasing (replace) | The hub client: **⇄ Change lease** on Pipeline rows, the dialog, the change history | built |
| `ad_wa_apply_amend.js` | SuiteScripts/AmicusLeasing (new) | Workflow Action Script **Apply Lease Amendment**; same executor and write module as the hub | built |

Source in the repo: `src/shared/rules/leaseChange.js` (planner), `src/shared/rules/leaseChangeMeta.js` (the nine change types and lists), `src/server/leaseChange.js` (executor), `src/server/routes/leaseChange.js` (hub route), `src/server/wa_apply_amend.js` (workflow action), `src/client/screens/pipeline/ChangeLeaseDialog.jsx`. Tests: `test/rules/leaseChange.test.js`, `test/server/leaseChange.test.js`.

## 3. NetSuite objects to create (sandbox first)

### 3.1 Lists (Customization › Lists, Records & Fields › Lists › New)

| Name | ID to type | Values, in order | Status |
|---|---|---|---|
| Amendment Type | `_ad_amend_type` | Revise; Supersede; Terminate; Cancel; Transfer; Assignment | to build |
| Amendment Status | `_ad_amend_status` | Draft; Pending approval; Approved; Sent for signature; Signed; Applied; Rejected; Withdrawn; Failed | to build |
| Lease End Reason | `_ad_end_reason` | Completed; Cancelled before start; Transferred; Released early; Superseded by amendment | to build |

Spell the values exactly; the code matches them by name, ignoring case and punctuation.

### 3.2 Record type "Lease Amendment" (Record Types › New)

Name **Lease Amendment**, ID `_ad_lease_amend`. Include Name Field ticked. Show ID ticked. Allow Quick Search ticked. Access Type: Use Permission List; leasing roles **Edit**, Administrator **Full**. Status: to build.

Fields (Fields subtab › New Field; save after each). ID prefix `custrecord` is added by NetSuite.

| Label | ID to type | Type | Settings |
|---|---|---|---|
| Lease | `_ad_am_lease` | List/Record → Lease | **Record is Parent** ticked; Show in List; Mandatory |
| Type | `_ad_am_type` | List/Record → Amendment Type | Show in List |
| Status | `_ad_am_status` | List/Record → Amendment Status | Show in List; Mandatory |
| Change | `_ad_am_scenario` | Free-Form Text | Show in List (holds the change key, e.g. RENEGOTIATE) |
| Effective date | `_ad_am_effective` | Date | Show in List |
| Reason | `_ad_am_reason` | Long Text | |
| Tenants added | `_ad_am_tenants_added` | Multiple Select → Customer | |
| Tenants removed | `_ad_am_tenants_removed` | Multiple Select → Customer | |
| Old monthly rent | `_ad_am_old_rent` | Currency | |
| New monthly rent | `_ad_am_new_rent` | Currency | Show in List |
| Fee | `_ad_am_fee` | Currency | |
| Provisions | `_ad_am_provisions` | Long Text | |
| Before (snapshot) | `_ad_am_before` | Long Text | Display Type: Inline Text |
| Plan | `_ad_am_plan` | Long Text | Display Type: Inline Text (written by the hub; do not edit) |
| Other lease | `_ad_am_other_lease` | List/Record → Lease | (scenario 2) |
| Target unit | `_ad_am_target_unit` | List/Record → Units/Bedrooms | (scenario 1) |
| Resulting lease | `_ad_am_result_lease` | List/Record → Lease | Display Type: Inline Text |
| Requested by | `_ad_am_requested_by` | List/Record → Employee | Show in List |
| Approved by | `_ad_am_approved_by` | List/Record → Employee | set by the workflow |
| Applied | `_ad_am_applied` | Date/Time | Display Type: Inline Text |
| Signed document | `_ad_am_document` | Free-Form Text | PandaDoc document id of the signed addendum |
| Result | `_ad_am_result` | Long Text | Display Type: Inline Text |

Because Lease is a parent, each lease shows its amendments on a subtab.

### 3.3 Lease record fields (Lease record type › Fields › New Field)

| Label | ID to type | Type | Status |
|---|---|---|---|
| Supersedes | `_ad_lease_supersedes` | List/Record → Lease | to build |
| End reason | `_ad_lease_end_reason` | List/Record → Lease End Reason | to build |
| Version | `_ad_lease_version` | Integer Number | to build |

### 3.4 List values on existing lists (add only)

| Where | Add | Status |
|---|---|---|
| `customlist_lease_group_type` (today: New Group, Transfers, Renewal) | **Amendment** | to build |
| Setup › Sales › Customer Statuses › New | **Released**, stage Customer, probability 0 (shows as Tenant-Released) | to build · decision 4 |

### 3.5 Scripts

| Object | Settings | Status |
|---|---|---|
| Script record **Apply Lease Amendment**, ID `_ad_wa_apply_amend`, file `ad_wa_apply_amend.js` | Type Workflow Action. Parameter `_ad_wa_apply_on_approval` (Check Box, label "Apply on approval"). Return type Free-Form Text. | to build |
| Deployment | Applies To: Lease Amendment. Status Released. Log Level Error. Execute as role: Administrator (so the workflow can write the leases whatever the approver's role). | to build |
| Leasing Hub script, new parameter | `_al_amend_apply_on_approval` (Check Box) "Apply amendments on approval". Leave unticked. | to build · decision 2 |

### 3.6 Workflow "Lease Amendment Approval" (Customization › Workflow › New)

Record Type Lease Amendment. Initiation: On Create; also On View or Update (so buttons work on existing rows). Release Status: Testing in the sandbox. Workflow field: **Apply result** (Free-Form Text). Status: to build · decision 1 for the approver.

| State | On entry | Buttons / transitions |
|---|---|---|
| Pending approval | Send email to the approver: "Lease change to approve", with a link to the record | **Approve** (approver only) → Approved, setting Approved by = current user · **Reject** → Rejected |
| Approved | Set Status = Approved · email the requester: "Approved: send the addendum from PandaDoc" | **Mark sent** → Sent for signature · **Withdraw** → Withdrawn |
| Sent for signature | Set Status = Sent for signature | **Mark signed** (until Salora's status check does it) → Signed · **Withdraw** → Withdrawn |
| Signed | Set Status = Signed · **Custom action: Apply Lease Amendment** → store in Apply result | Apply result starts with APPLIED or ALREADY → Applied · otherwise → Failed |
| Applied | Lock the record (all fields Inline Text) · email the requester the result | none (end) |
| Failed | Email the administrator with Apply result · the hub shows an **Apply** button to retry | **Retry apply** → Signed |
| Rejected, Withdrawn | Set Status · email the requester | none (end) |

The script sets Status = Applied or Failed itself, so the workflow's own Set Field on those states is optional. With "Apply on approval" ticked, add the custom action on Approved as well.

### 3.7 Roles (add, never remove)

Leasing roles: Custom Record › Lease Amendment = Edit; Lists › Customers = Edit (already); the three new lists need no permission. Approver role: Lease Amendment = Edit, plus whatever the workflow's button restrictions name.

### 3.8 PandaDoc templates (in each workspace that sends leases)

| Document | Use for | What exists today | Status |
|---|---|---|---|
| Lease Addendum | renegotiation, mid-term adjustment, provisions, tenant added | "LEASE ADDENDUM Change of address", "Amendment with co-sign" | to adapt · decision |
| Assignment / Substitution | tenant replaced | none | to build |
| Release | one tenant released | "LEASE RELEASE AGREEMENT" | to adapt |
| Termination | whole group released, transfer | none | to build |

## 4. Asks for Salora (PandaDoc integration)

| # | Ask | Why | Status |
|---|---|---|---|
| S1 | A **Void and regenerate** action on the lease for In Process leases: void the sent Lease Documents and recreate drafts from the current lease | The Revise path today tells the agent to void by hand in PandaDoc | ask Salora |
| S2 | A **Superseded / Voided** status on Lease Documents rows, excluded from "all signed" | A replaced document must not block Fully Executed | ask Salora |
| S3 | Send an addendum from a **Lease Amendment** (template per amendment type, recipients = tenants on the amendment + guarantors), and have the status check set the amendment to **Signed** and fill Signed document | Lets the workflow run without "Mark signed" | ask Salora |
| S4 | Handle **Declined** and **Expired** | Not in the current build | ask Salora |
| S5 | Fill `netsuite_tenant_id` on every document (blank on 26 of 30 recent ones) | Needed to know which tenant signed which document | ask Salora |
| S6 | Lease 7198 (2152 14th St Unit 2) did not flip to Fully Executed although all three tenants signed by 11/05 | Status check miss | ask Salora |
| S7 | Webhook instead of hourly polling, or a shorter interval | Amendments are time-sensitive | ask Salora |
| S8 | Confirm their tenant-status logic (Tenant-New / Tenant-Renewal) will not overwrite **Released**, and list every script on the Lease and Customer records (the apply step must not fight them) | Conflicting writers | ask Salora |
| S9 | Lock Fully Executed so only the status check sets it | Manual early flags (7513, 6780) | ask Salora · decision |

## 5. Defaults chosen until Amicus decides

| # | Default in the code | Decision it waits on |
|---|---|---|
| D1 | Every change to a Fully Executed lease needs approval | Which changes need approval, and by whom |
| D2 | Applied only when Signed (parameter can allow Approved) | Can a manager apply on approval? |
| D3 | New lease total = monthly × months, partial months pro rata by days | Proration convention (rent schedule decision 2) |
| D4 | New customer status **Released** | Released vs Lost Customer |
| D5 | Superseding and transfer leases carry no sent or signed date (the amendment does), so they never count as new leasing in Weekly or velocity | — |
| D6 | Effective date = first day of the new arrangement; whatever ends, ends the day before | — |
| D7 | Same terms + roster change = assignment on the signed lease; any change to rent or dates = supersede | — |
| D8 | New lease name = old name + " · v2" (transfer: "<unit> · transfer from <old name>") | Naming convention |
| D9 | Released tenants stay on the old lease record; the amendment lists who left | Keep linked, or only via the amendment |
| D10 | Ended and superseding leases are skipped by the "Total Rent ≠ monthly × term" check | — |

## 6. Sandbox test script (once 3.1–3.6 exist)

1. Hub › Setup: every "Lease changes" row reads Created.
2. A draft lease (no status): Change lease › tick Tenant(s) joining › add a tenant › Preview › Make the change. The tenant is on the lease, the change is listed as Applied.
3. An In Process lease: tick Rent changes › new rent › Make the change. Rent and total updated, stage Lease Revisions, "To do: void and resend" shown.
4. A Fully Executed lease: tick Rent changes › effective date + new rent › File amendment. The lease is unchanged; the amendment is Pending approval.
5. Approve, Mark sent, Mark signed. The workflow applies it: old lease ends the day before, new lease linked with Supersedes and group Amendment, amendment Applied with the resulting lease.
6. Tick Leaving + Joining (replace a tenant, same terms): roster changes on the same lease, the old tenant is Released.
7. Tick Lease ends early, after the start date: terminated with Released early; before the start date: inactivated, Cancelled before start.
8. Tick Group moves: tenants gain the new property, old lease Transferred, new lease at the target with group Transfers.
9. Tick Leaving + "moving to another of our leases": removed here, added there.
10. Run Apply on an already Applied amendment: nothing changes.
11. Reporting: the superseding lease does not appear in Weekly "sent / signed this week"; beds are counted once.

## 7. Revision log

| Date | Change |
|---|---|
| 2026-11-08 | First build: planner, executor, hub route and dialog, Workflow Action Script, setup checks, tests (153 passing). Objects in §3 specified; none created yet (no browser access to the sandbox from this session). Salora's PandaDoc build (Send Contract V2, hourly Status Check, Lease Documents subtab) folded in: §4 lists what it still needs. |
| 2026-11-08 | Cowork prompt now reads the files from `Desktop\Leasing JS` (OneDrive), checks MANIFEST.json for build e1f82f529b0d before uploading, and ignores older files in that folder. |
| 2026-11-08 | Change lease is now **tick all that apply** (7 conditions) instead of picking one of nine scenarios; the hub routes the ticks to the workflow (table in §1). Build **034ae66b3299**: re-upload the three hub files (`amicus_leasing_sl.js`, `amicus_leasing_app.js`, `amicus_leasing_app.css`) over the sandbox copies; `ad_wa_apply_amend.js` is unchanged in behaviour (re-upload too so the build ids match). Test script §6 reworded for the ticks. |
