/** A fake N/query that answers the DAO's SuiteQL from a fixture, by table name. Shared by the server tests and the preview harness. */
export function fakeQuery(fixture, { missingFields = ['custrecord_ad_uas_lease_terms'], employeeMarkets = 'Bethlehem, Troy' } = {}) {
  const missing = new Set(missingFields);
  const tableRows = (sql) => {
    const t = /FROM\s+([a-z0-9_]+)/i.exec(sql)[1].toLowerCase();
    if (sql.includes('ROWNUM <= 1') && !sql.includes('ROWNUM rn')) return [{}];
    const map = { customrecord_serp_property_record: 'properties', customrecord_serp_units_bedrooms: 'units', customrecord_serp_lease_record: 'leases', customrecord_serp_academic_yr_details: 'targets', customrecord_serp_academic_yr_list: 'academic_years', customrecord_ad_unit_ay_status: 'stage_rows', customrecord_ad_uas_note: 'stage_notes', customrecord_ad_uas_stage_log: 'stage_log', customer: 'customers', subsidiary: 'subsidiaries' };
    if (t === 'employee') return [{ markets: employeeMarkets }];
    if (t === 'entitystatus') return fixture.lists.entitystatus.map((s) => ({ id: s.key, name: s.name, entitytype: s.entitytype, inactive: s.inactive || 'F' }));
    if (t.startsWith('customlist')) return fixture.lists[t] || [];
    if (t === 'customrecord_ad_write_audit' || t === 'customrecord_ad_saved_view') return [];
    if (t === 'map_customrecord_serp_lease_record_custrecord_serp_tenants_') {
      // tenant → leases, from the lease rows' tenants string
      const m = /maptwo IN \(([^)]*)\)/.exec(sql); const ids = m ? new Set(m[1].split(',').map((x) => x.trim())) : null;
      const out = []; for (const l of fixture.leases) { if (l.isinactive === 'T' || !l.tenants) continue; for (const c of String(l.tenants).split(/[,\s]+/)) if (c && (!ids || ids.has(c))) out.push({ lease: l.id, customer: Number(c) }); } return out;
    }
    if (t.startsWith('map_')) return [];
    let rows = fixture[map[t]] || [];
    if (/isinactive = 'F'/.test(sql)) rows = rows.filter((r) => r.isinactive !== 'T');
    const ayIn = /custrecord_serp_academic_year IN \(([^)]*)\)|custrecord_ad_uas_ay IN \(([^)]*)\)/.exec(sql);
    if (ayIn) { const ids = new Set((ayIn[1] || ayIn[2]).split(',').map((x) => Number(x))); rows = rows.filter((r) => ids.has(Number(r.ay))); }
    if (t === 'customer') {
      if (/stage = 'CUSTOMER'/.test(sql)) rows = rows.filter((r) => r.stage === 'CUSTOMER');
      if (/NOT EXISTS \(SELECT 1 FROM map_customer_custentity_serp_ent_property/.test(sql)) rows = rows.filter((r) => !r.property);
      if (/NOT EXISTS \(SELECT 1 FROM map_customer_custentity_serp_academic_year/.test(sql)) rows = rows.filter((r) => !r.ay);
      if (/LOWER\(c\.firstname/.test(sql)) { const q = /LIKE '%([^']*)%'/.exec(sql)[1]; rows = rows.filter((r) => `${r.firstname || ''} ${r.lastname || ''} ${r.email || ''} ${r.desired_location || ''}`.toLowerCase().includes(q)); }
      const statusIn = /c\.entitystatus IN \(([^)]*)\)/.exec(sql); if (statusIn) { const ids = new Set(statusIn[1].split(',').map(Number)); rows = rows.filter((r) => ids.has(Number(r.entitystatus))); }
      const statusName = (r) => ({ 13: 'Tenant-Closed Won', 15: 'Tenant-Renewal', 16: 'Tenant-Lost Customer', 17: 'Tenant-New', 18: 'Tenant-Inquiring' })[r.entitystatus] || null;
      if (/COUNT\(\*\) AS n FROM customer/.test(sql)) return [{ n: rows.length }];
      if (/GROUP BY LOWER\(email\)/.test(sql)) { const c = new Map(); for (const r of rows) if (r.email) { const k = r.email.toLowerCase(); c.set(k, (c.get(k) || 0) + 1); } return [...c].filter(([, n]) => n > 1).map(([email, n]) => ({ email, n })); }
      rows = rows.slice().sort((a, b) => `${a.lastname || ''}${a.firstname || ''}`.localeCompare(`${b.lastname || ''}${b.firstname || ''}`));
      if (/ROWNUM rn/.test(sql)) { const m = /rn > (\d+) AND rn <= (\d+)/.exec(sql); rows = rows.slice(Number(m[1]), Number(m[2])); }
      return rows.map((r) => ({ ...r, status_name: statusName(r) }));
    }
    return rows.map((r) => ({ ...r, lease_type_name: r.lease_type === 1 ? 'Whole House' : r.lease_type === 2 ? 'Unit' : r.lease_type === 3 ? 'Bedroom' : null, status_name: r.status === 1 ? 'Fully Executed' : r.status === 2 ? 'In Process' : null, ay_name: (fixture.academic_years.find((a) => a.id === r.ay) || {}).name || null }));
  };
  return {
    runSuiteQL: ({ query }) => { if (/ROWNUM <= 1/.test(query) && [...missing].some((f) => query.includes(f))) throw new Error('Unknown identifier'); return { asMappedResults: () => tableRows(query) }; },
    runSuiteQLPaged: ({ query, pageSize }) => { const rows = tableRows(query); const ranges = []; for (let i = 0; i * pageSize < Math.max(rows.length, 1); i++) ranges.push({ index: i }); return { pageRanges: ranges, fetch: ({ index }) => ({ data: { asMappedResults: () => rows.slice(index * pageSize, (index + 1) * pageSize) } }) }; },
  };
}
