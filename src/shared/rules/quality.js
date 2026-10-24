/**
 * Data-quality lists (v2 Exceptions tab parity): property/unit record gaps the report works around,
 * lease dates and statuses the weekly report depends on, and tenant-record checks. Advisory: none of
 * these exclude a lease (the excluding rules live in placement.js). Pure.
 */
import { SEGMENTS } from '../constants.js';
import { dayNum } from './dates.js';
import { propertyOf, linkedName } from './summary.js';

const mainSeg = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;

export const RECORD_ISSUES = {
  ORPHAN_BEDROOM: { issue: 'Bedroom record whose parent unit is missing or inactive', handling: 'Treated as its own unit so its beds still count', fix: 'Reactivate the parent unit or move the bedroom under the right unit.' },
  UNIT_ZERO_BEDS: { issue: 'Unit has no bedroom records and no bed count', handling: 'Counts as 0 beds', fix: 'Set Number of Beds on the unit, or add its bedroom records.' },
  UNIT_BED_COUNT_DIFFERS: { issue: 'Unit bed count differs from its bedroom records', handling: 'Bedroom records win', fix: 'Correct Number of Beds on the unit or on the bedrooms.' },
  BEDROOM_PROPERTY_MISMATCH: { issue: 'Bedroom points at a different property than its unit', handling: "The unit's property is used", fix: 'Correct the Property on the bedroom record.' },
  BEDROOM_PROPERTY_INHERITED: { issue: 'Bedroom has no Property', handling: "Inherits the unit's property", fix: 'Set the Property on the bedroom record.' },
  PROPERTY_ONLY_LEAF: { issue: 'Property has no unit records', handling: 'Its own bedroom count is used as one leaf', fix: 'Create the Units/Bedrooms records so leases can link to them.' },
  PARENT_PROPERTY_MISSING: { issue: 'Parent property is missing or inactive', handling: 'Treated as a top-level property', fix: 'Reactivate the parent or clear the Parent field.' },
  FUND_UNMAPPED: { issue: 'Subsidiary does not map to a fund', handling: 'Shown under "Unmapped fund"', fix: 'Add the subsidiary to the fund rules (constants.js) or correct the Subsidiary on the property.' },
  MARKET_UNMAPPED: { issue: 'City does not map to a market', handling: 'Shown under "Unmapped city"; never in a market lock', fix: 'Set the City on the property to one of the market spellings.' },
  UNIT_PROPERTY_MISSING: { issue: 'Unit points at a missing or inactive property', handling: 'Unit is dropped from the inventory', fix: 'Correct the Property on the unit.' },
  TARGET_NO_UNIT: { issue: 'Academic Year Details row has no active unit', handling: 'Target not used', fix: 'Set the Unit on the Academic Year Details row or inactivate it.' },
  TARGET_DUPLICATE: { issue: 'Unit has more than one Academic Year Details row', handling: 'Latest row used', fix: 'Inactivate the duplicate Academic Year Details row.' },
};

/** Property & unit record issues from the inventory build plus target issues from the run. */
export function recordQuality(run, { keep = () => true } = {}) {
  const inv = run.inventory;
  const out = [];
  const push = (code, x, kind, recordId, record) => {
    const meta = RECORD_ISSUES[code]; if (!meta) return;
    const p = inv.propertiesById.get(String(x.propertyId || (x.unitId && (inv.unitsById.get(String(x.unitId)) || {}).propertyId) || ''));
    if (p && !keep(p)) return;
    if (!p && !keep({ fund: null, marketId: 'unknown' })) return;
    out.push({ code, issue: meta.issue, handling: meta.handling, fix: meta.fix, kind, recordId: recordId ? String(recordId) : null, record, property: p ? p.name : '', propertyId: p ? p.id : null, market: p ? p.marketLabel : '', detail: x.detail || '' });
  };
  for (const x of inv.issues) {
    if (x.code === 'ORPHAN_BEDROOM' || x.code === 'UNIT_ZERO_BEDS' || x.code === 'UNIT_BED_COUNT_DIFFERS' || x.code === 'UNIT_PROPERTY_MISSING') push(x.code, x, 'unit', x.unitId, (inv.unitsById.get(String(x.unitId)) || {}).name || `Unit #${x.unitId}`);
    else if (x.code === 'BEDROOM_PROPERTY_MISMATCH' || x.code === 'BEDROOM_PROPERTY_INHERITED') push(x.code, x, 'unit', x.bedroomId, (inv.bedroomsById.get(String(x.bedroomId)) || {}).name || `Bedroom #${x.bedroomId}`);
    else push(x.code, x, 'property', x.propertyId, (inv.propertiesById.get(String(x.propertyId)) || {}).name || `Property #${x.propertyId}`);
  }
  for (const x of run.targetIssues || []) push(x.code, x, 'details', x.targetId, `Details #${x.targetId}`);
  return out;
}

/** Lease dates and statuses the weekly report depends on, for the selected AY (every status, both bases). */
export function leaseQuality(run, { keep = () => true, today, ayEnd } = {}) {
  const t = dayNum(today), end = dayNum(ayEnd);
  const out = [];
  for (const r of run.placement.leaseResults.values()) {
    if (r.year.carried) continue;
    const p = propertyOf(run, r); if (p && !keep(p)) continue;
    const l = r.lease;
    const push = (code, issue, handling, fix, detail) => out.push({ code, issue, handling, fix, detail: detail || '', kind: 'lease', recordId: l.id, record: l.name, property: p ? p.name : '', propertyId: p ? p.id : null, market: p ? p.marketLabel : '', linked: linkedName(run, r), mrev: l.monthlyRent, status: l.statusKey });
    const signed = dayNum(l.signedDate);
    if (l.statusKey === 'EXECUTED' && signed == null) push('EXEC_NO_SIGNED', 'Fully Executed lease has no Lease Signed Date', 'Counted in totals; left out of the weekly history', 'Enter the Lease Signed Date.');
    if (l.statusKey === 'IN_PROCESS' && !l.sentDate) push('INPROC_NO_SENT', 'In Process lease has no Lease Sent Date', 'Left out of the pro-forma weekly history and days-in-process', 'Enter the Lease Sent Date.');
    if (l.termMismatch) push('TERM_MISMATCH', 'Lease Duration says two years but the dates cover one', 'Counted in a single academic year, following the dates', 'Correct the Lease End Date, or the Lease Duration by Months.', `Duration ${l.durationField} mo, dates ${l.dateMonths} mo`);
    if (l.statusKey === 'NONE') push('NO_STATUS', 'Lease Status is blank', 'Left out of the leasing statistics entirely until a status is set', 'Set Lease Status to In Process once the lease goes out, or Fully Executed once it is signed.');
    if (signed != null && t != null && signed > t) push('SIGNED_FUTURE', 'Lease Signed Date is in the future', 'Weekly history uses it as entered', 'Correct the Lease Signed Date.', `Signed ${l.signedDate}`);
    else if (signed != null && end != null && signed > end) push('SIGNED_AFTER_AY', 'Lease Signed Date is after the academic year ends', 'Weekly history uses it as entered', 'Correct the Lease Signed Date or the Academic Year.', `Signed ${l.signedDate}`);
    if (l.statusKey === 'OTHER') push('UNKNOWN_STATUS', 'Lease Status is not Fully Executed or In Process', 'Skipped on both bases', 'Set a recognised Lease Status.', `Status value ${l.statusRaw}`);
  }
  return out;
}

/**
 * Tenant-record checks on the leases counted this year: no tenant records linked, Number of Tenants
 * mismatch, same tenant on more than one lease (double-booked), inactive tenant on an active lease, no email.
 *   customersById: Map(id → { id, name, email, isinactive })  (the DAO supplies it for the linked ids only)
 */
export function tenantQuality(run, { keep = () => true, customersById = new Map() } = {}) {
  const out = [];
  const byTenant = new Map();
  for (const r of run.placement.leaseResults.values()) {
    if (r.year.carried || r.status === 'skipped' || r.lease.statusKey === 'NONE') continue;
    const p = propertyOf(run, r); if (!p || !mainSeg(p) || !keep(p)) continue;
    const l = r.lease;
    const base = { kind: 'lease', recordId: l.id, record: l.name, property: p.name, propertyId: p.id, market: p.marketLabel, linked: linkedName(run, r), mrev: l.monthlyRent };
    const ids = l.tenantIds, n = l.tenantCount;
    if (!ids.length) out.push({ ...base, code: 'NO_TENANTS', issue: 'Lease has no tenant records linked', detail: `Number of Tenants ${n}`, sev: 1, fix: n ? `Add the ${n} tenant record${n === 1 ? '' : 's'} to the lease's Tenants field.` : 'Add the tenants to the Tenants field and set Number of Tenants.', related: [] });
    else if (ids.length !== n) out.push({ ...base, code: 'TENANT_COUNT', issue: 'Number of Tenants does not match linked tenants', detail: `Number of Tenants ${n} · linked ${ids.length}`, sev: 1, fix: `Set Number of Tenants to ${ids.length}, or link the missing / remove the extra tenant records.`, related: ids.slice(0, 12).map((id) => ({ kind: 'tenant', id, name: nameOf(customersById, id) })) });
    for (const id of ids) { if (!byTenant.has(id)) byTenant.set(id, []); byTenant.get(id).push({ r, p }); }
  }
  for (const [id, list] of byTenant) {
    const c = customersById.get(String(id)) || null;
    const first = list[0];
    const base = { kind: 'tenant', recordId: String(id), record: nameOf(customersById, id), property: first.p.name, propertyId: first.p.id, market: first.p.marketLabel, linked: linkedName(run, first.r), mrev: null };
    const leaseRef = ({ r }) => ({ kind: 'lease', id: r.lease.id, name: r.lease.name });
    if (list.length > 1) {
      const places = list.map(({ r, p }) => `${p.name}${linkedName(run, r) ? ` — ${linkedName(run, r)}` : ''}`);
      const mkts = [...new Set(list.map(({ p }) => p.marketLabel))];
      const dupRent = list.reduce((s, { r }) => s + r.lease.monthlyRent, 0) - list[0].r.lease.monthlyRent;
      out.push({ ...base, code: 'TENANT_MULTI', issue: 'Tenant is on more than one active lease in this AY', sev: 2, detail: `${list.length} leases · ${places.join(' | ')}${mkts.length > 1 ? ` · ${mkts.join(' + ')}` : ''}`, places, markets: mkts, mrev: Number(dupRent.toFixed(2)), dupLeases: list.length, fix: 'Keep the tenant on the correct lease and remove them from the others (or inactivate the duplicate lease).', related: list.map(leaseRef) });
    }
    if (c && c.isinactive === 'T') out.push({ ...base, code: 'TENANT_INACTIVE', issue: 'Tenant record is inactive but on an active lease', detail: '', sev: 1, fix: 'Reactivate the tenant record, or remove the tenant from the lease.', related: list.map(leaseRef) });
    if (c && !c.email) out.push({ ...base, code: 'TENANT_NO_EMAIL', issue: 'Tenant has no email address', detail: '', sev: 0, fix: 'Add an email address on the tenant record.', related: list.map(leaseRef) });
  }
  return out;
}
function nameOf(map, id) { const c = map.get(String(id)); return c ? (c.name || `Tenant #${id}`) : `Tenant #${id}`; }
