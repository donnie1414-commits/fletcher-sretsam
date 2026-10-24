#!/usr/bin/env node
/**
 * npm run probe — the schema/lead/tour discovery queries behind docs/LEAD-DISCOVERY.md and docs/SCHEMA.md,
 * runnable again whenever the account changes. Prints Markdown. Needs NS_* credentials (read-only) —
 * or paste each SQL into the NetSuite connector / SuiteQL tool. `--suite leads|schema|all`.
 */
import { hasCredentials, suiteql } from './netsuite-rest.mjs';
export const PROBES = {
  schema: [
    ['Custom record types in play', `SELECT scriptid, name, internalid FROM customrecordtype WHERE LOWER(scriptid) LIKE 'customrecord_serp%' OR LOWER(scriptid) LIKE 'customrecord_ad_%' ORDER BY scriptid`],
    ['Leasing stage list', 'SELECT id, name, isinactive FROM customlist_ad_leasing_stage ORDER BY id'],
    ['Lease type / status / group type', `SELECT 'type' AS list, id, name, isinactive FROM customlist_serp_lease_type_list UNION ALL SELECT 'status', id, name, isinactive FROM customlist_serp_lease_status UNION ALL SELECT 'group', id, name, isinactive FROM customlist_lease_group_type`],
    ['Property types', 'SELECT id, name FROM customlist830 ORDER BY id'],
    ['Counts', `SELECT (SELECT COUNT(*) FROM customrecord_serp_property_record WHERE isinactive='F') AS properties, (SELECT COUNT(*) FROM customrecord_serp_units_bedrooms WHERE isinactive='F' AND parent IS NULL) AS units, (SELECT COUNT(*) FROM customrecord_serp_units_bedrooms WHERE isinactive='F' AND parent IS NOT NULL) AS bedrooms, (SELECT COUNT(*) FROM customrecord_serp_lease_record WHERE isinactive='F') AS leases, (SELECT COUNT(*) FROM customrecord_ad_unit_ay_status) AS stage_rows, (SELECT COUNT(*) FROM customer WHERE isinactive='F' AND stage='CUSTOMER') AS tenants FROM DUAL`],
  ],
  leads: [
    ['Customer counts by stage and status', `SELECT stage, entitystatus, BUILTIN.DF(entitystatus) AS status_name, COUNT(*) AS n, SUM(CASE WHEN isinactive = 'F' THEN 1 ELSE 0 END) AS active FROM customer GROUP BY stage, entitystatus, BUILTIN.DF(entitystatus) ORDER BY stage, entitystatus`],
    ['Entity status list', 'SELECT key, name, entitytype, inactive, probability, descr FROM entitystatus ORDER BY entitytype, key'],
    ['Populated lead fields by stage', `SELECT stage, COUNT(*) AS n, SUM(CASE WHEN custentity_desired_location IS NOT NULL THEN 1 ELSE 0 END) AS desired_location, SUM(CASE WHEN custentity_serp_schools IS NOT NULL THEN 1 ELSE 0 END) AS school, SUM(CASE WHEN custentity_serp_group_size IS NOT NULL THEN 1 ELSE 0 END) AS group_size, SUM(CASE WHEN custentity_serp_house_mates IS NOT NULL THEN 1 ELSE 0 END) AS house_mates, SUM(CASE WHEN custentity_serp_howdid_you_hear_about_us IS NOT NULL THEN 1 ELSE 0 END) AS hear_us, SUM(CASE WHEN custentity1 IS NOT NULL THEN 1 ELSE 0 END) AS lead_entry_date, SUM(CASE WHEN custentity3 = 'T' THEN 1 ELSE 0 END) AS tour_scheduled, SUM(CASE WHEN custentity9 IS NOT NULL THEN 1 ELSE 0 END) AS tour_date, SUM(CASE WHEN custentity12 IS NOT NULL THEN 1 ELSE 0 END) AS agent_assigned, SUM(CASE WHEN custentity_serp_properties_to_show IS NOT NULL THEN 1 ELSE 0 END) AS properties_shown, SUM(CASE WHEN salesrep IS NOT NULL THEN 1 ELSE 0 END) AS salesrep, SUM(CASE WHEN leadsource IS NOT NULL THEN 1 ELSE 0 END) AS leadsource FROM customer WHERE isinactive = 'F' GROUP BY stage`],
    ['Tenants missing Property / Academic Year (via map tables)', `SELECT (SELECT COUNT(*) FROM customer c WHERE c.isinactive='F' AND c.stage='CUSTOMER' AND NOT EXISTS (SELECT 1 FROM map_customer_custentity_serp_ent_property m WHERE m.mapone=c.id)) AS no_property, (SELECT COUNT(*) FROM customer c WHERE c.isinactive='F' AND c.stage='CUSTOMER' AND NOT EXISTS (SELECT 1 FROM map_customer_custentity_serp_academic_year m WHERE m.mapone=c.id)) AS no_ay FROM DUAL`],
    ['Inbound volume by month and status', `SELECT TO_CHAR(datecreated,'YYYY-MM') AS month, BUILTIN.DF(entitystatus) AS status, COUNT(*) AS n FROM customer WHERE isinactive='F' AND datecreated >= TO_DATE('2026-01-01','YYYY-MM-DD') GROUP BY TO_CHAR(datecreated,'YYYY-MM'), BUILTIN.DF(entitystatus) ORDER BY 1,2`],
    // The following need an Administrator (the integration role cannot see them). Paste into Analytics or the SuiteQL tool as admin:
    ['[ADMIN] Events (tours?) on customers', `SELECT COUNT(*) AS n, MIN(startdate) AS first, MAX(startdate) AS last FROM calendarevent`],
    ['[ADMIN] Tasks / phone calls on customers', `SELECT 'task' AS kind, COUNT(*) AS n FROM task UNION ALL SELECT 'phonecall', COUNT(*) FROM phonecall`],
    ['[ADMIN] Scripts touching customer / lease', `SELECT s.name, s.scriptid, s.scripttype, d.recordtype, d.isdeployed, d.status FROM script s JOIN scriptdeployment d ON d.script = s.id WHERE d.recordtype IN ('customer','customrecord_serp_lease_record','customrecord_ad_unit_ay_status') ORDER BY s.scripttype, s.name`],
    ['[ADMIN] Workflows on customer / lease', `SELECT name, scriptid, recordtype, isinactive, releasestatus FROM workflow WHERE recordtype IN ('customer','customrecord_serp_lease_record') ORDER BY name`],
    ['[ADMIN] Employee market-lock field coverage', `SELECT COUNT(*) AS employees, SUM(CASE WHEN custentity_lkr_markets IS NULL THEN 1 ELSE 0 END) AS blank_markets FROM employee WHERE isinactive='F'`],
  ],
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const suite = (process.argv.find((a) => a.startsWith('--suite=')) || '--suite=all').slice(8);
  const list = suite === 'all' ? [...PROBES.schema, ...PROBES.leads] : PROBES[suite] || [];
  if (!hasCredentials()) { console.log('# Probe queries (no NS_* credentials: printing SQL only)\n'); for (const [title, sql] of list) console.log(`## ${title}\n\n\`\`\`sql\n${sql}\n\`\`\`\n`); process.exit(0); }
  for (const [title, sql] of list) {
    console.log(`## ${title}\n`);
    try { const r = await suiteql(sql, { limit: 200 }); const rows = r.items.map(({ links, ...x }) => x); if (!rows.length) { console.log('(no rows)\n'); continue; } const cols = Object.keys(rows[0]); console.log(`| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`); for (const row of rows) console.log(`| ${cols.map((c) => row[c] ?? '').join(' | ')} |`); console.log(); }
    catch (e) { console.log(`_${e.message}_\n`); }
  }
}
