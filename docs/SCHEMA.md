# Schema notes from the live probe (2026-10-23)

Records and the fields the workspace reads. Every optional field is probed at startup (`src/server/schema.js`); a missing one degrades its feature and is reported in the bootstrap.

## Records and counts

| Record | Script id (internal) | Rows | Notes |
|---|---|---:|---|
| Property | `customrecord_serp_property_record` (1057) | 815 (812 active) | 138 have a `parent` property; city in `custrecord_serp_prop_city` (text), subsidiary in `custrecord_serp_proj_subsidiary`, type in `custrecord_serp_property_type_cr` (`customlist830`: Residential/Commercial/Land/Office), own bedroom count `custrecord_number_of_bedrooms` |
| Units/Bedrooms | `customrecord_serp_units_bedrooms` (1058) | 6,802 (1,445 units + 5,351 bedrooms active) | unit = `parent IS NULL`; property `custrecord_serp_parent_property`; beds `custrecord_serp_number_of_beds` (never blank today); Rentroom id `custrecord_serp_rentroom_unit_id` |
| Lease | `customrecord_serp_lease_record` (1056) | 2,559 (2,057 active) | type `custrecord_serp_lease_type_test` (1 Whole House 891 · 2 Unit 1,040 · 3 Bedroom 126); status `custrecord_serp_lease_status` (1 Fully Executed 1,841 · 2 In Process 145 · blank 71); AY `custrecord_serp_lease_academic_year`; dates `custrecord_serp_lease_start_date` / `_end_date`; duration `custrecord_serp_lease_duration_options` (integer months, 23 blank); monthly `custrecord_monthly_actual_rent`; total `custrecord_serp_rent_actual_total`; tenants `custrecord_serp_tenants_` (multi → customer; map table `MAP_customrecord_serp_lease_record_custrecord_serp_tenants_`, 8,349 pairs); headcount `custrecord_serp_number_of_tenants` (always equals attached count); sent `custrecord_serp_lease_sent_date`; signed `custrecord_effective_date` (label "Lease Signed Date"); group type `custrecord_serp_group_type` (New Group 1,900 · Transfers 20 · Renewal 137); utilities `custrecord_serp_watersewer_included` / `custrecord_serp_gaselectric_included` (+ caps); provisions `custrecord_serp_additional_provisions`; 435 whole-house leases have no unit link (property-wide), 456 are linked to a unit |
| Academic Year | `customrecord_serp_academic_yr_list` (1055) | 6 | ids: 7 = AY 2025-2026, 4 = 2026-2027, 2 = 2027-2028, 3 = 2028-2029, 5 = 2029-2030 (1 = inactive test); dates `custrecord_start_date` / `custrecord_serp_acad_end_date` (6/1 → 5/31) |
| Academic Year Details (targets) | `customrecord_serp_academic_yr_details` (1054) | 3,130 | one per **unit** per AY: unit `custrecord_serp_unit`, property `custrecord_serp_test_units_br` (mislabelled), AY `custrecord_serp_academic_year`, `custrecord_serp_target_rent_perbed`, `custrecord_serp_target_rent_monthly` (26-27: 615 rows; 27-28: 1,255; 28-29: 1,256) |
| Unit Leasing Status | `customrecord_ad_unit_ay_status` (1465) | 4,384 | §5.4 fields present except `custrecord_ad_uas_lease_terms`; stage source `custrecord_ad_uas_stage_source` → `customlist_ad_stage_source` (1 Manual, 2 Lease); stages in use: 3 (5 rows), 4 (132), 5 (1,570), blank (2,677) |
| Unit Leasing Note | `customrecord_ad_uas_note` (1566) | 2 | `custrecord_ad_note_status` (parent row), `_text`, `_date`, `_author`, `_mentions` |
| Unit Leasing Stage Log | `customrecord_ad_uas_stage_log` (1567) | 28 | `custrecord_ad_log_status`, `_from`, `_to`, `_source`, `_user`, `_date` — exists; the brief did not mention it |
| Customer | `customer` | 8,338 (7,968 active) | see LEAD-DISCOVERY for the field inventory; relationship fields `custentity_serp_ent_property` / `custentity_serp_academic_year` with map tables `map_customer_custentity_serp_ent_property` (8,372) / `map_customer_custentity_serp_academic_year` (8,986) |
| Subsidiary | `subsidiary` | 16 | A1: 3 Amicus 1 ▸ 4 PC Assets ▸ 5 02908 Holdco · A2: 6 Amicus 2 ▸ 7 NY, 14 Pennsylvania, 15 Troy · A3: 16 Amicus 3 ▸ 17 Alma Mater REIT, 18 Miami of Ohio, 19 A3 Miami 1 |

## Lists

`customlist_ad_leasing_stage`: 1 Renewal Declined · 2 Lease Form Collection (inactive) · 3 Ready For Lease - Waiting on Forms · 4 Lease Out - Unsigned · 5 Fully Executed · 6 Offline · 7 Renewal Offered. **In Negotiations is missing** (checklist C).
`customlist_serp_cities` (property `custrecordcity_dropd`): 1 Bethlehem · 2 Binghamton · 3 Charleston · 4 New Orleans · 5 Providence · 6 Savannah · 7 Troy (Oxford has none).
`customlist_serp_hear_us_list`, `customlist_serp_schools`, `customlist1160` (RentRoom status): in `test/fixtures/*/lists.json`.

## Things SuiteQL will not do here

- `BUILTIN.DF`, `CASE`, `IS NOT NULL` on `custentity_serp_ent_property` / `custentity_serp_academic_year` return the literal `RELATIONSHIP FIELD`; a plain `SELECT` of the column works and returns "2, 3". Filter through the map tables.
- `customfield`, `script`, `workflow`, `employee`, `calendarevent`, `task` are not visible to the integration role.
- Union queries mixing `BUILTIN.DF` across record types fail with "Invalid or unsupported search"; run them separately.
- Pagination through the connector saves any result over ~25k tokens to a file; the ingest tool (`tools/ingest-connector-results.mjs`) rebuilds tables from those files and verifies page completeness.

## Two-year candidates (24 leases, dates ≥ 14.5 months or duration ≥ 15)

Ids 4, 1770, 5, 1815, 2124, 2287, 4653, 6502, 2312, 3556, 1208, 6632, 6631, 2939, 2385, 2259, 1615, 4483, 4491, 2922, 2925, 2246, 6498, 2126. Three disagree between field and dates: 2287 (field 18, dates 12 → `TERM_MISMATCH`), 3556 and 2922 (field 12, dates 24 → treated as two-year by the dates).
