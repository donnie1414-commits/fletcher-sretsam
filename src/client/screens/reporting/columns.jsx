/** Leasing Details report types (v2 parity): one tree, report types pick the column groups. Column notes feed the Descriptions toggle. */
import { fmtInt, fmtMoney, fmtPct, fmtPts, fmtGrowth, fmtSigned, fmtDate, fmtMoney2, occTone, paceTone } from '../../format.js';
import { OccPill } from '../../ui.jsx';

export const REPORT_TYPES = [
  { key: 'occrev', label: 'Occupancy & Revenue', groups: ['occ', 'rev'], note: 'Beds, occupancy and revenue at every level.' },
  { key: 'yoy', label: 'Year over Year', groups: ['yoy'], note: 'Occupied beds, occupancy and monthly revenue vs the prior academic year (final).' },
  { key: 'vacancy', label: 'Vacancy', groups: ['occ', 'tgt'], vac: true, note: 'Only properties, units and bedrooms with vacant beds, with their target rent.' },
  { key: 'rent', label: 'Rent & Same-Store', groups: ['rev', 'rent'], note: 'Rent per bed and per person; same-store rent on units 100% leased in both years.' },
  { key: 'tgt', label: 'Targets', groups: ['occ', 'tgt'], note: 'Academic Year Details target and settle rent vs actual.' },
  { key: 'lease', label: 'Leases & Headcount', groups: ['head', 'type', 'term'], note: 'People, lease counts, lease-type mix and lease terms.' },
  { key: 'all', label: 'All Columns', groups: ['occ', 'rev', 'yoy', 'rent', 'tgt', 'head', 'type', 'term'], note: 'Every column (wide).' },
];
const money = (k, label, note, w = 110) => ({ key: k, label, type: 'money', width: w, note });
const pct = (k, label, note, w = 90) => ({ key: k, label, type: 'pct', width: w, note });
const int = (k, label, note, w = 80) => ({ key: k, label, type: 'number', width: w, note });
const pts = (k, label, note) => ({ key: k, label, width: 100, align: 'right', note, render: (v) => (v == null ? '–' : <span className={v > 0.00005 ? 'delta up' : v < -0.00005 ? 'delta down' : ''}>{fmtPts(v)}</span>), csv: (r) => (r[k] == null ? '' : (r[k] * 100).toFixed(1)) });
const growth = (k, label, note) => ({ key: k, label, width: 90, align: 'right', note, render: (v) => (v == null ? '–' : <span className={v > 0.00005 ? 'delta up' : v < -0.00005 ? 'delta down' : ''}>{fmtGrowth(v)}</span>), csv: (r) => (r[k] == null ? '' : (r[k] * 100).toFixed(1)) });
const signedInt = (k, label, note) => ({ key: k, label, width: 90, align: 'right', note, render: (v) => (v == null ? '–' : <span className={v > 0 ? 'delta up' : v < 0 ? 'delta down' : ''}>{fmtSigned(v)}</span>) });

/** Column groups keyed by report-type group id. `cur`/`ly` are the short AY labels for headers. */
export function columnGroups(cur, ly) {
  return {
    occ: [int('occupied', 'Occupied', 'Beds covered by a counted lease'), int('vacant', 'Vacant', 'Total beds less occupied'), { key: 'occPct', label: 'Occupancy %', width: 100, align: 'right', note: 'Occupied ÷ total beds (a ratio of sums at every level). Green ≥ 95%, amber ≥ 80%, red below', render: (v) => <OccPill r={v} />, csv: (r) => (r.occPct == null ? '' : (r.occPct * 100).toFixed(1)) }, pct('finOccPct', 'Financial Occ. %', 'Σ(occupied beds × min(term, 12)) ÷ 12 ÷ total beds')],
    rev: [money('monthly', 'Monthly Revenue', 'Monthly rent on the counted leases'), money('annual', 'Total Revenue', 'Monthly rent × months in this academic year (full term)', 120)],
    yoy: [int('occupied', `Occupied ${cur}`, 'Occupied beds this year'), int('pOccupied', `Occupied ${ly}`, 'Occupied beds on the same records last year (final)'), signedInt('occChange', 'Change', 'Occupied this year less last year'),
      { key: 'occPct', label: `Occ. % ${cur}`, width: 100, align: 'right', note: '', render: (v) => <OccPill r={v} />, csv: (r) => (r.occPct == null ? '' : (r.occPct * 100).toFixed(1)) }, pct('pOccPct', `Occ. % ${ly}`, ''), pts('occDelta', 'Change (pts)', 'Occupancy points gained or lost'),
      money('monthly', `Monthly ${cur}`, ''), money('pMonthly', `Monthly ${ly}`, 'Monthly rent on the same records last year'), growth('mrevYoY', 'YoY %', 'Monthly revenue growth')],
    rent: [money('rentPerBed', 'Rent / Bed', 'Monthly rent ÷ occupied beds', 100), money('rentPerPerson', 'Rent / Person', 'Monthly rent ÷ people', 100), int('ssBeds', 'Same-Store Beds', 'Beds in units 100% leased in both years with no excluded lease'), money('ssCur', `SS Rent ${cur}`, 'Monthly rent on same-store beds this year', 110), money('ssPrior', `SS Rent ${ly}`, 'Monthly rent on the same beds last year', 110), growth('ssYoY', 'SS YoY %', 'Same-store rent growth')],
    tgt: [money('targetMonthly', 'Target Rent (Monthly)', 'Academic Year Details target for this AY', 130), money('targetPerBed', 'Target / Bed', 'Target ÷ beds with a target', 100), growth('actVsTarget', 'Actual vs Target', 'Signed rent on targeted, occupied beds vs their target'), money('targetVacant', 'Vacant Target Rent', 'Target on beds not yet leased', 120), money('settleMonthly', 'Settle Rent (Monthly)', 'The floor leasing may settle at', 130), money('prevRentPerBed', 'Prior-Yr Rent / Bed', 'Prior-year rent per bed from Academic Year Details', 120)],
    head: [int('people', 'People', 'Number of Tenants on the counted leases, split by bed'), int('activeLeases', 'Active Leases', 'Counted leases whose scope is this node'), int('excludedLeases', 'Excluded', 'Leases excluded by an exception on this node')],
    type: [int('occWH', 'Whole House', 'Occupied beds under whole-house leases'), int('occUnit', 'Unit', 'Occupied beds under unit leases'), int('occBed', 'Bedroom', 'Occupied beds under bedroom leases')],
    term: [{ key: 'leaseType', label: 'Lease Type', width: 110, note: 'Whole House / Unit / Bedroom / Mixed / Vacant', value: (r) => (r.leaf ? r.leaf.type : '') }, { key: 'leaseStart', label: 'Lease Start', width: 100, type: 'date', note: 'Earliest start on the leaf', value: (r) => (r.leaf ? r.leaf.start : null) }, { key: 'leaseEnd', label: 'Lease End', width: 100, type: 'date', note: 'Latest end on the leaf', value: (r) => (r.leaf ? r.leaf.end : null) }, { key: 'months', label: 'Months', type: 'number', width: 70, note: 'Months counted in this AY (capped at 12)', value: (r) => (r.leaf ? r.leaf.months : null) }],
  };
}
export const BASE_COLS = [int('beds', 'Total Beds', 'Σ beds on the lowest-level records (the one denominator)')];
/** Summary group tables (By Market / By Fund), v2 SUM_COLS. The pace columns only show when a prior year exists. */
export function summaryColumns({ hasPace, ly, lyAsOf }) {
  const cols = [
    { label: 'Total Beds', value: (r) => fmtInt(r.beds), note: 'Σ beds' }, { label: 'Occupied', value: (r) => fmtInt(r.occ), note: 'Beds under a counted lease' }, { label: 'Vacant', value: (r) => fmtInt(r.vacant), note: 'Beds − occupied' },
    { label: 'Occ. %', value: (r) => <OccPill r={r.occPct} d={hasPace ? r.lyWkDelta : null} />, note: hasPace ? 'Occupied ÷ beds. Green = ahead of the same date last year, amber within 3 pts, red further behind' : 'Occupied ÷ beds. Green ≥ 95%, amber ≥ 80%, red below' },
  ];
  if (hasPace) cols.push({ label: `Same date ${ly}`, value: (r) => fmtPct(r.lyWkOccPct), note: `${ly} leases counted by ${lyAsOf}` }, { label: 'vs same date', value: (r) => <DeltaPts v={r.lyWkDelta} />, note: 'Points ahead (+) or behind (−) the same date last year' });
  if (ly) cols.push({ label: `${ly} final`, value: (r) => fmtPct(r.pOccPct), note: 'Where the prior year finished on the same records' }, { label: 'vs final', value: (r) => <DeltaPts v={r.occDelta} />, note: 'Points vs the prior year final' });
  cols.push({ label: 'Fin. Occ. %', value: (r) => fmtPct(r.finPct), note: 'Lease months capped at 12' }, { label: 'People', value: (r) => fmtInt(r.people), note: 'Number of Tenants' }, { label: 'Leases', value: (r) => fmtInt(r.leases), note: 'Counted leases' }, { label: 'Excluded', value: (r) => fmtInt(r.excluded), note: 'Leases knocked out by an exception' },
    { label: 'Monthly Revenue', value: (r) => fmtMoney(r.mrev), note: 'Monthly rent on counted leases' }, { label: 'Total Revenue', value: (r) => fmtMoney(r.trev), note: 'Full term' });
  if (hasPace) cols.push({ label: `Rev. vs same date`, value: (r) => <DeltaGrowth v={r.trevPace} />, note: 'Total revenue vs the same date last year' });
  cols.push({ label: 'Rent / Bed', value: (r) => fmtMoney2(r.rentBed), note: 'Monthly ÷ occupied beds' });
  if (ly) cols.push({ label: `${ly} Rent / Bed`, value: (r) => fmtMoney2(r.pRentBed), note: 'Prior-year final rent per bed' }, { label: 'Rent/Bed YoY', value: (r) => <DeltaGrowth v={r.rentBedYoY} />, note: '' });
  return cols;
}
export function DeltaPts({ v }) { return v == null ? <span className="muted">–</span> : <span className={`delta ${v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : ''}`}>{fmtPts(v)}</span>; }
export function DeltaGrowth({ v }) { return v == null ? <span className="muted">–</span> : <span className={`delta ${v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : ''}`}>{fmtGrowth(v)}</span>; }
export { fmtDate };
