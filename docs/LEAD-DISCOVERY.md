# §5.5.0 Lead discovery — write-up for review

Probed live on 2026-10-23 through the NetSuite connector (role `customrole_ai_claude`, account 8229294, read-only SuiteQL).
Nothing in §6.5 Leads has been designed. This document stops at the findings and one recommendation about *which data to design for*.

## 1. What physically holds a lead

**The native customer entity record. There is no custom lead record.**

| Container | Internal id / stage | Rows | Notes |
|---|---|---:|---|
| `customer`, stage **LEAD** | entitystatus 6 "Lead-New" | 4 active (4 total) | All four created 8/31–9/21/2026, two by the countersigner's address: test entries. |
| `customer`, stage **PROSPECT** | entitystatus 8 "Prospect-In Discussion" | 1 | Created 7/30/2026 with an internal email: a test entry. |
| `customer`, stage **CUSTOMER**, status **Tenant-New** (17) | | **865 active** (1,016 total) | This is where real inbound inquiries land: 539 created in Sep 2026, 320 in Oct 2026 (through 10/23). |
| `customer`, other CUSTOMER statuses | Closed Won 13 / Renewal 15 / Lost Customer 16 | 6,863 / 229 / 6 active | Tenants. |
| `customrecord_*` for leads, tours, inquiries, applications | — | **none** | All 224 custom record types were listed; the only leasing records are the `customrecord_serp_*` set (Property, Units/Bedrooms, Lease, Academic Year, Academic Year Details, Lease Document, Pandadoc Workspace) and the `customrecord_ad_*` pipeline set (Unit Leasing Status, Unit Leasing Note, Unit Leasing Stage Log). |

How a lead enters: the recent Tenant-New rows (12 created on 10/23 alone, all Lehigh) carry a free-text *Desired Location/House* ("411 Webster st", "231 e morton"), a school, an Academic Year, a housemates list, and **no Property**. That is the shape of the public Lead Form (online entity form, script 1728 per the leasing guide) writing straight into a customer record at status Tenant-New. The same record later gets Property/AY set and is attached to a lease.

## 2. Field inventory (customer record, lead-relevant fields)

Counts are active rows with a value. CUSTOMER n = 7,963; LEAD n = 4. "Populated" for the two relationship fields is measured through the map tables (an expression on the field itself returns the literal string `RELATIONSHIP FIELD` and counts every row).

| Internal id | Type | Label | Populated (CUSTOMER) | Populated (LEAD) | Verdict |
|---|---|---|---:|---:|---|
| `entitystatus` | list | Status | 7,963 | 4 | the workflow field |
| `custentity_serp_ent_property` | multi-select → Property | Property | 7,819 (144 blank) | 4 | the attach filter |
| `custentity_serp_academic_year` | multi-select → Academic Year | Academic Year | 7,896 (67 blank) | 3 | the attach filter |
| `custentity_serp_schools` | list `customlist_serp_schools` | College/University | 6,868 | 3 | **the only reliable market signal** on a lead (Providence College 2,526 · Lehigh 1,863 · Binghamton 1,349 · RPI 407 · SCAD 205 · JWU 198 · Tulane 155 · CofC 51 · RIC 46 · Brown 42 · DeSales 18 · Bryant 7 · RISD 3 · Loyola 1) |
| `custentity_desired_location` | free text | Desired Location/House | 1,120 | 0 | property of interest as typed by the applicant; usable with fuzzy matching, not as a key |
| `custentity_serp_group_size` | integer | Group Size | 1,501 | 2 | |
| `custentity_serp_house_mates` | free text | Housemates | 1,083 | 0 | names, one per line |
| `custentity_serp_notes` | free text | Notes | 1,027 | 0 | |
| `custentity_serp_howdid_you_hear_about_us` | list `customlist_serp_hear_us_list` (Referred From a Friend · Google · Amicus Website · Instagram · Amicus Event · Other) | How Did you hear about us? | **14** | 0 | source: exists, 0.2% populated |
| `leadsource` | native | Lead Source | 0 | 0 | unused |
| `salesrep` | native | Sales Rep | 0 | 0 | unused |
| `custentity12` | free text | Agent Assigned | 1 | 1 | owning agent: exists as text, unused |
| `custentity1` | date | Lead Entry Date | 1 | 2 | unused |
| `custentity2` | checkbox | Roommate Matching | 0 | 3 | |
| `custentity3` | checkbox | Tour Scheduled | 0 | 0 | unused |
| `custentity9` | date | Tour Date | 9 | 0 | essentially unused |
| `custentity_serp_properties_to_show` | free text | Properties Shown | 0 | 0 | unused |
| `custentity_serp_showing_notification` | checkbox | Showing Notification | 210 (all F) | 0 | unused |
| `custentity6` | free text | Desired Unit Size | 0 | 3 | |
| `custentity_serp_budget` | free text | Rent Budget/Bed | 0 | 0 | unused |
| `custentity_expected_arrival_date`, `custentity_savannah_cycle`, `custentity_savannah_arrival_date` | date / list / date | | 0 | 0 | unused |
| `custentity4` / `custentity5` | checkbox | Lease Sent / Lease Signed | 5,777 / 6,559 | 0 | set by the lease flow, not by hand |
| `custentity14` | list `customlist1160` | RentRoom Upload Status | 7,027 | 0 | operations, not leasing |
| `custentity_serp_cosigner_*`, `custentity_serp_security_dep_*` | text | Co-signer, home address | 4,175 / 1,225 | 0 | application data |
| `duplicate` | native flag | Duplicate | 2,949 flagged | 3 | NetSuite's own duplicate detection is on and noisy |
| `email` / phone | | | 7,453 / 7,453 | 3 / 3 | |

Everything with a verdict of "unused" is a field that exists and is ≤ 0.2% populated: not a field a workflow can be built on today.

## 3. The status list (`entitystatus`)

| Stage | id | Name | Active rows | In real use? |
|---|---:|---|---:|---|
| LEAD | 6 | New | 4 | test only |
| LEAD | 19 | In Contact | 0 | no |
| LEAD | 23 | Tour Scheduled | 0 | no |
| LEAD | 22 | Tour Completed | 0 | no |
| LEAD | 20 | Received Lease Form | 0 | no |
| LEAD | 21 | Spam | 0 | no |
| LEAD | 24 | Dead Lead | 0 | no |
| LEAD | 7 | Qualified | 0 | inactive |
| PROSPECT | 8–12, 14 | native (In Discussion … Closed Lost) | 1 | test only |
| CUSTOMER | 17 | New ("Tenant-New") | 865 | **yes — the inbound queue** |
| CUSTOMER | 18 | Inquiring ("for current tenants reaching out to rent again") | **0** | no (listed in the brief as in use; it is not) |
| CUSTOMER | 13 | Closed Won | 6,863 | yes |
| CUSTOMER | 15 | Renewal | 229 | yes (Aug–Sep 2026) |
| CUSTOMER | 16 | Lost Customer | 6 | barely |

The order people actually move through: **Tenant-New → (Property + AY set, attached to a lease) → Tenant-Closed Won**, with Tenant-Renewal used for returning tenants at renewal time. Somebody designed a lead funnel on the LEAD stage (New → In Contact → Tour Scheduled → Tour Completed → Received Lease Form, with Spam and Dead Lead as exits) and it has never been used: the form creates CUSTOMER-stage records directly.

## 4. How a lead connects to property, unit, market, academic year, agent and source

Same record, same field ids as the tenant side — there is no second set of ids.

| Link | Field | On a fresh inquiry |
|---|---|---|
| Property | `custentity_serp_ent_property` (multi) | blank (144 Tenant-stage rows blank today, 128 of them Tenant-New) |
| Unit | — none — | the free-text *Desired Location/House* is the only unit-level hint |
| Market | — none — | derive from school (`custentity_serp_schools`) or, once set, from Property's city |
| Academic Year | `custentity_serp_academic_year` (multi) | usually set by the form (e.g. "2, 3" = AY 27-28 and 28-29) |
| Owning agent | `custentity12` Agent Assigned (free text, 1 row); `salesrep` (0) | nothing usable |
| Source | `custentity_serp_howdid_you_hear_about_us` (14 rows); `leadsource` (0) | nothing usable |

## 5. How a lead becomes a tenant today

Nothing converts. The record is created as a CUSTOMER at Tenant-New; `convertedtocustomer`, `dateconversion`, `datelead` and `dateprospect` are all 0 on the 7,963 active tenant-stage rows. Becoming a tenant means: Property and Academic Year get filled (by the Lease Application Form, script 1828, or by hand), the customer is added to a lease's Tenants multiselect (allowed only when Property and AY match the lease), and the status is set to Closed Won. **This decides §6.5: it is one dataset.** Leads and Tenants are two segments of the same customer rows, split by status (and by "attached to a lease yet"), sharing the DataGrid and the server-side filter/paging. No migration, no sync, nothing to merge.

## 6. What exists for tours or showings

- On the customer: `custentity3` Tour Scheduled (checkbox, never true), `custentity9` Tour Date (9 rows), `custentity_serp_properties_to_show` Properties Shown (0 rows), `custentity_serp_showing_notification` (210 rows, all unchecked). Vestigial.
- Native CRM Events, Tasks and Phone Calls: **could not be read with this role** (`calendarevent`, `task` are not visible to `customrole_ai_claude`). The CRM feature is enabled on the account. The three `[ADMIN]` queries in `tools/probe.js` answer this in one minute from an Administrator session.
- No custom tour record (see §1).

The §5.6 recommendation (native Event + a custom `custevent_ad_tour_unit` link to Units/Bedrooms) is not contradicted by anything found; it cannot be confirmed as "nothing already exists" until the admin queries run.

## 7. Anything already operating on leads

Visible from this role: nothing can be listed (`script`, `scriptdeployment`, `workflow` and File Cabinet search are all denied). Known from the account's own documentation and from the data:

- **Lead Form** (online entity form, script 1728, `extforms.netsuite.com`) and **Lease Application Form** (script 1828) write customer records; the 10/23 Tenant-New rows have exactly the fields those forms carry.
- The PandaDoc sync sets `custentity4`/`custentity5` Lease Sent/Signed on customers and the lease's sent/signed dates (out of scope, §11).
- The RentRoom upload workflow drives `custentity14` (7,027 rows) — operations, not leasing.
- NetSuite's native duplicate detection is on (2,949 customers carry the duplicate flag).

Run the `[ADMIN]`-tagged queries in `tools/probe.js` (scripts and workflows deployed on `customer` and the lease record) before anything is built on the customer record, so the workspace does not write over a User Event or workflow that is already acting on status changes.

## What to design for (recommendation, pending your review)

**The lead side is not a backlog; it is an inbound stream that is being worked by hand in the wrong tool.** 859 inquiries arrived as Tenant-New in the last eight weeks, each carrying a free-text house, a school and an AY, and almost nothing else that a workflow can key on. The structured lead fields (source, agent, tour date, lead statuses) exist and are empty.

So the Leads segment's first job should be **fast, low-friction triage of new inquiries**: turn a typed "411 Webster st" into a Property link (fuzzy picker over the user's markets), confirm the AY, assign the agent, schedule the tour, and watch the duplicate flag — three taps on a phone, per row and in bulk. Not: managing a large structured pipeline. The "needs attention" default view writes itself: Tenant-New, created in the last N days, with no Property or no lease.

Two things need a decision before design starts, and both are changes to the lead model that §5.5.0 says not to propose unilaterally:

1. **Which statuses the Leads segment moves people through.** The LEAD-stage funnel (In Contact → Tour Scheduled → Tour Completed → Received Lease Form, exits Spam / Dead Lead) is the natural fit but would require the form to create LEAD-stage records, or the workspace to flip stage, which changes how every downstream report counts "tenants". The alternative is to keep everything at CUSTOMER stage and add the needed statuses there. Either way, "Inquiring" (18) is unused and could be the renewal-inquiry bucket its description says it is.
2. **Where the owning agent lives.** `custentity12` is free text with one value; the native `salesrep` is empty but is what NetSuite's own assignment, reminders and calendar expect. Using `salesrep` costs nothing and makes tours (Events organised by the rep) line up; it is still a model change.

Until those are answered, §6.5 builds the **Tenants** segment only (it is specified, unblocked, and the 144 / 67 blank-Property / blank-AY rows are the live problem). The Leads segment will reuse the same grid and the same dataset.
