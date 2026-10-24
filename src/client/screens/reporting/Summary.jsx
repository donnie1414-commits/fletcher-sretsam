import { useState } from 'react';
import { useRoute } from '../../hooks.js';
import { recordUrl } from '../../api.js';
import { Tile, Disclosure, Skeleton, ErrorBox, Button, Toggle, Table, Pill, Section } from '../../ui.jsx';
import { fmtInt, fmtMoney, fmtMoney2, fmtMoneyK, fmtPct, fmtPts, fmtGrowth, fmtSigned, fmtDate, ayShort, toCSV, downloadCSV, occTone, paceTone, isNum } from '../../format.js';
import { summaryColumns, DeltaPts, DeltaGrowth } from './columns.jsx';

const D = (v, f) => (isNum(v) ? <span className={`delta ${v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : ''}`}>{f(v)}</span> : <span className="muted">–</span>);

export function Summary({ sel, presentation }) {
  const { data, error, loading } = useRoute('summary', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  const [desc, setDesc] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Skeleton rows={4} />;
  const p = data.kpi.total, v = data.vacancy;
  const ly = data.prior ? ayShort(data.ay - 1) : null;
  const hasPace = !!(data.pace && ly && isNum(p.lyWkOccPct));
  const basisLabel = sel.basis === 'executed' ? 'Fully Executed' : 'Pro-forma (Executed + In Process)';
  const paceRow = (val, d) => (hasPace ? ['Same date LY', val, d] : null);
  const finalRow = (val, d) => (ly ? ['LY final', val, d] : null);
  const cols = summaryColumns({ hasPace, ly, lyAsOf: data.pace ? fmtDate(data.pace.lyAsOf) : '' });
  const tiesOk = data.ties.people && data.ties.mrev && data.ties.trev;
  const tcols = [
    { label: 'Occupied Beds', value: (r) => fmtInt(r.occ), note: 'Beds under this type' }, { label: 'Share', value: (r) => fmtPct(r.occShare), note: 'Of all occupied beds' }, { label: 'Occ. %', value: (r) => fmtPct(r.occPct), note: 'Of total beds' },
    ...(hasPace ? [{ label: `Same date ${ly}`, value: (r) => fmtPct(r.lyWkOccPct), note: '' }, { label: 'vs same date', value: (r) => <DeltaPts v={r.lyWkDelta} />, note: '' }] : []),
    ...(ly ? [{ label: `${ly} final`, value: (r) => fmtPct(r.pOccPct), note: '' }, { label: 'vs final', value: (r) => <DeltaPts v={r.occDelta} />, note: '' }] : []),
    { label: 'Fin. Occ. %', value: (r) => fmtPct(r.finPct), note: '' }, { label: 'Leases', value: (r) => fmtInt(r.leases), note: '' }, { label: 'Excluded', value: (r) => fmtInt(r.excluded), note: '' }, { label: 'People', value: (r) => fmtInt(r.people), note: '' },
    { label: 'Monthly Revenue', value: (r) => fmtMoney(r.mrev), note: '' }, { label: 'Total Revenue', value: (r) => fmtMoney(r.trev), note: '' }, ...(hasPace ? [{ label: 'Rev. vs same date', value: (r) => <DeltaGrowth v={r.trevPace} />, note: '' }] : []),
    { label: 'Rent / Bed', value: (r) => fmtMoney2(r.rentBed), note: '' }, { label: 'Rent / Person', value: (r) => fmtMoney2(r.rentPerson), note: '' },
  ];
  const typeTotal = { occ: p.occ, occShare: p.occ ? 1 : null, occPct: p.occPct, lyWkOccPct: p.lyWkOccPct, lyWkDelta: p.lyWkDelta, pOccPct: p.pOccPct, occDelta: p.occDelta, finPct: p.finPct, leases: p.leases, excluded: p.excluded, people: p.people, mrev: p.mrev, trev: p.trev, trevPace: p.trevPace, rentBed: p.rentBed, rentPerson: p.rentPerson };
  return (
    <div className={presentation ? 'present' : ''}>
      <div className="tiles six">
        <Tile label="Total Beds" value={fmtInt(p.beds)} rows={[['Properties', fmtInt(data.propertyCount)], ['Markets', fmtInt(data.marketCount)]]} />
        <Tile label="Occupied Beds" value={fmtInt(p.occ)} rows={[paceRow(fmtInt(p.lyWkOcc), D(isNum(p.lyWkOcc) ? p.occ - p.lyWkOcc : null, fmtSigned)), finalRow(fmtInt(p.pOcc), D(isNum(p.pOcc) ? p.occ - p.pOcc : null, fmtSigned))]} note={basisLabel} />
        <Tile label={data.ay > data.currentAy ? 'Pre-leased' : 'Occupancy'} value={fmtPct(p.occPct)} tone={hasPace ? paceTone(p.lyWkDelta) : occTone(p.occPct)} rows={[paceRow(fmtPct(p.lyWkOccPct), D(p.lyWkDelta, fmtPts)), finalRow(fmtPct(p.pOccPct), D(p.occDelta, fmtPts))]} />
        <Tile label="Vacant Beds" value={fmtInt(p.vacant)} rows={[['Fully vacant units', fmtInt(v.fullUnits), <span className="muted">{fmtInt(v.fullBeds)} beds</span>], ['Partly vacant units', fmtInt(v.partUnits), <span className="muted">{fmtInt(v.partBeds)} beds</span>]]} />
        <Tile label="Financial Occupancy" value={fmtPct(p.finPct)} tone={occTone(p.finPct)} rows={[finalRow(fmtPct(p.pFinPct), D(isNum(p.pFinPct) ? p.finPct - p.pFinPct : null, fmtPts))]} note="Lease months capped at 12" />
        <Tile label="Total Revenue" value={fmtMoney(p.trev)} rows={[paceRow(fmtMoneyK(p.lyWkTrev), D(p.trevPace, fmtGrowth)), finalRow(fmtMoneyK(p.pTrev), D(p.trevYoY, fmtGrowth))]} note="Rent actual, full term" />
      </div>
      {hasPace && <p className="muted small">“Same date” counts {ly} leases {sel.basis === 'executed' ? 'signed' : 'sent'} on or before {fmtDate(data.pace.lyAsOf)}, the same point in the leasing cycle as today. “LY final” is where the prior year finished on the same records.</p>}
      <div className="toolbar"><Toggle label="Descriptions" checked={desc} onChange={setDesc} /><span className="muted small">{data.ay > data.currentAy ? `A future year: figures are pre-lease to date.` : 'Pro-forma = Executed + In Process.'}</span></div>
      <GroupTable title="By Market" note={`Market = property City. Expand a market for its funds.${ly ? ` LY = ${ly}.` : ''}`} groups={data.kpi.byMarket} total={p} cols={cols} desc={desc} csvName={`summary-by-market-${sel.ay}-${sel.basis}.csv`} />
      <GroupTable title="By Fund" note={`Fund = top-level subsidiary (Amicus I / II / III). Expand a fund for its markets.${ly ? ` LY = ${ly}.` : ''}`} groups={data.kpi.byFund} total={p} cols={cols} desc={desc} csvName={`summary-by-fund-${sel.ay}-${sel.basis}.csv`} />
      <Section title="By Lease Type" note="Whole House covers every bed in a property (or the linked house). Unit covers every bed in a unit. Bedroom covers one bedroom.">
        <Table cols={[{ label: 'Lease Type', align: 'l', value: (r) => <Pill tone={r.key === 'WH' ? 'done' : r.key === 'UNIT' ? 'active' : 'muted'}>{r.name}</Pill>, foot: () => 'Total', note: 'Whole House / Unit / Bedroom' }, ...tcols.map((c) => ({ ...c, foot: () => c.value(typeTotal) }))]} rows={data.byLeaseType} keyOf={(r) => r.key} foot={typeTotal} notes={desc} rowClass={(r) => (r.leases || r.excluded || r.pLeases ? '' : 'zero')} />
      </Section>
      {data.str && data.str.properties > 0 && <Disclosure defaultOpen summary={<span>Short-term rentals <span className="count">{fmtInt(data.str.properties)} {data.str.properties === 1 ? 'property' : 'properties'} · {fmtInt(data.str.total.beds)} beds · {fmtMoney(data.str.total.trev)}</span></span>}>
        <p className="muted small">Nightly and short-stay lettings. <strong>Not</strong> in any figure above: the booking cycle has nothing to do with the academic year and rent per bed runs several times the student rate, so mixing them would distort pre-lease and rent/bed.</p>
        <Table cols={[{ label: 'Property', align: 'l', value: (r) => <a className="link" href={recordUrl('property', r.id)} target="_blank" rel="noreferrer">{r.name}</a> }, { label: 'Market', align: 'l', value: (r) => r.market }, { label: 'Fund', align: 'l', value: (r) => r.fund }, { label: 'Beds', value: (r) => fmtInt(r.beds) }, { label: 'Occupied', value: (r) => fmtInt(r.occ) }, { label: 'Occ. %', value: (r) => fmtPct(r.occPct) }, { label: 'Leases', value: (r) => fmtInt(r.leases) }, { label: 'Excluded', value: (r) => fmtInt(r.excluded) }, { label: 'Rent / Bed', value: (r) => fmtMoney(r.rentBed) }, { label: 'Total Revenue', value: (r) => fmtMoney(r.trev) }]} rows={data.str.rows} />
      </Disclosure>}
      {data.commercial && data.commercial.properties > 0 && <Disclosure defaultOpen={data.commercial.leases > 0} summary={<span>Commercial, land &amp; office <span className="count">{fmtInt(data.commercial.leased)} of {fmtInt(data.commercial.properties)} leased · {fmtMoney(data.commercial.annual)}/yr</span></span>}>
        <p className="muted small">No student beds, so these are reported on rent alone and never touch occupancy. Annual is monthly × 12: Total Rent on these records holds a year, not the contract value, so a multi-year commercial lease would read short.</p>
        <Table cols={[{ label: 'Property', align: 'l', value: (r) => <a className="link" href={recordUrl('property', r.id)} target="_blank" rel="noreferrer">{r.name}</a>, foot: () => 'Total' }, { label: 'Market', align: 'l', value: (r) => r.market }, { label: 'Fund', align: 'l', value: (r) => r.fund }, { label: 'Status', align: 'l', value: (r) => r.status }, { label: 'Leases', value: (r) => fmtInt(r.leases), foot: (t) => fmtInt(t.leases) }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.monthly), foot: (t) => fmtMoney2(t.monthly) }, { label: 'Annual Rent', value: (r) => fmtMoney(r.annual), foot: (t) => fmtMoney(t.annual) }, { label: 'Term Start', value: (r) => fmtDate(r.start) }, { label: 'Term End', value: (r) => fmtDate(r.end) }]} rows={data.commercial.rows} foot={data.commercial} rowClass={(r) => (r.leases ? '' : 'zero')} />
      </Disclosure>}
      <Disclosure defaultOpen={data.recent.length > 0} summary={<span>New Lease Records <span className="count">created in the last 3 days · {fmtInt(data.recent.length)}</span></span>}>
        <p className="muted small">Active lease records created since {fmtDate(data.recentSince)}, all academic years{sel.fund || sel.market ? ', selected fund/market' : ''}.</p>
        <Table cols={[{ label: 'Lease', align: 'l', value: (r) => <a className="link" href={recordUrl('lease', r.id)} target="_blank" rel="noreferrer">{r.name}</a> }, { label: 'Academic Year', align: 'l', value: (r) => r.ay || '–' }, { label: 'Status', align: 'l', value: (r) => r.status }, { label: 'Market', align: 'l', value: (r) => r.market }, { label: 'Property', align: 'l', value: (r) => r.property }, { label: 'Units/Bedroom', align: 'l', value: (r) => r.linked || '–' }, { label: 'Lease Type', align: 'l', value: (r) => r.type }, { label: 'Tenants', value: (r) => fmtInt(r.people) }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.mrev) }, { label: 'Sent', value: (r) => fmtDate(r.sent) }, { label: 'Signed', value: (r) => fmtDate(r.signed) }, { label: 'Created', value: (r) => fmtDate(r.created) }]} rows={data.recent} empty="Nothing created in the last 3 days." />
      </Disclosure>
      <div className={`ties ${tiesOk ? 'ok' : 'bad'}`}>{tiesOk ? '✓ People, monthly and total revenue tie to the counted leases.' : `⚠ Allocated totals do not tie to the counted leases (people ${data.ties.leasePeople} − ${data.ties.stackedPeople} sequential vs ${p.people}; monthly ${fmtMoney(data.ties.leaseMrev)} vs ${fmtMoney(p.mrev)}).`}</div>
      {data.degraded && data.degraded.length > 0 && <p className="muted small">Off because a field is missing: {data.degraded.map((x) => x.feature || x.field).join(', ')}.</p>}
    </div>
  );
}

/** Expandable two-level table (Market ▸ Fund or Fund ▸ Market) with a total row, the v2 groupTable. */
export function GroupTable({ title, note, groups, total, cols, desc, csvName }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };
  const rows = [];
  for (const g of groups) { rows.push({ ...g.row, _key: g.key, _group: true, _open: open.has(g.key), _n: g.children.length }); if (open.has(g.key)) for (const c of g.children) rows.push({ ...c, _key: `${g.key}:${c.name}`, _child: true }); }
  const allOpen = groups.length && groups.every((g) => open.has(g.key));
  const tcols = [{ label: title.replace('By ', '') + ' ▸', align: 'l', note: 'Expand a row for its breakdown', value: (r) => (r._group ? <button type="button" className="tree-toggle-text" onClick={() => toggle(r._key)} aria-expanded={r._open}>{r._open ? '▾' : '▸'} {r.name}</button> : <span className="child-name">{r.name}</span>), foot: () => 'Total' }, ...cols.map((c) => ({ ...c, foot: () => c.value(total) }))];
  return (
    <Section title={title} note={note} actions={<><Button small onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}>{allOpen ? 'Collapse' : 'Expand all'}</Button><Button small onClick={() => downloadCSV(csvName, toCSV(groups.flatMap((g) => [g.row, ...g.children.map((c) => ({ ...c, name: `  ${c.name}` }))]).concat([{ ...total, name: 'Total' }]), [{ key: 'name', label: 'Name' }, ...cols.map((c) => ({ label: c.label, value: (r) => { const v = c.value(r); return typeof v === 'string' ? v : (v && v.props && v.props.v != null ? v.props.v : ''); } }))]))}>CSV</Button></>}>
      <Table cols={tcols} rows={rows} keyOf={(r) => r._key} foot={total} notes={desc} rowClass={(r) => (r._child ? 'child' : 'group')} />
    </Section>
  );
}
