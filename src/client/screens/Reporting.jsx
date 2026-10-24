import { useMemo, useState } from 'react';
import { useRoute } from '../hooks.js';
import { Figure, Disclosure, Skeleton, ErrorBox, Segmented, Button, Toggle, Select } from '../ui.jsx';
import { DataGrid } from '../components/DataGrid/DataGrid.jsx';
import { LineChart } from '../components/Chart.jsx';
import { fmtInt, fmtMoney, fmtPct, fmtDelta, fmtDate, ayShort, toCSV, downloadCSV } from '../format.js';
import { MARKETS, FUNDS } from '../../shared/constants.js';

const marketLabel = (id) => (MARKETS.find((m) => m.id === id) || { label: id }).label;

export function Reporting({ sel, sub, setSub, density, presentation }) {
  return (
    <div className="screen">
      {!presentation && <div className="subnav"><Segmented ariaLabel="Reporting view" value={sub} onChange={setSub} options={[{ value: 'summary', label: 'Summary' }, { value: 'portfolio', label: 'Portfolio' }, { value: 'weekly', label: 'Weekly' }]} /></div>}
      {sub === 'summary' && <Summary sel={sel} presentation={presentation} />}
      {sub === 'portfolio' && <Portfolio sel={sel} density={density} />}
      {sub === 'weekly' && <Weekly sel={sel} />}
    </div>
  );
}

const M_COLS = [
  { key: 'name', label: 'Rollup', width: 180 },
  { key: 'beds', label: 'Beds', type: 'number', width: 80 }, { key: 'occupied', label: 'Occupied', type: 'number', width: 90 }, { key: 'vacant', label: 'Vacant', type: 'number', width: 80 },
  { key: 'occPct', label: 'Occ.', unit: '%', type: 'pct', width: 80 }, { key: 'finOccPct', label: 'Fin. occ.', unit: '%', type: 'pct', width: 90 },
  { key: 'monthly', label: 'Monthly', unit: '$', type: 'money', width: 110 }, { key: 'annual', label: 'Annual', unit: '$', type: 'money', width: 120 },
  { key: 'rentPerBed', label: 'Rent/bed', unit: '$', type: 'money', width: 90 }, { key: 'rentPerPerson', label: 'Rent/person', unit: '$', type: 'money', width: 100 }, { key: 'people', label: 'People', type: 'number', width: 80 },
];
export function Summary({ sel, presentation }) {
  const { data, error, loading } = useRoute('summary', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Skeleton rows={4} />;
  const s = data.student, d = data.deltas.total, future = data.ay > (data.currentAy || 0);
  const vs = `vs AY ${ayShort(data.ay - 1)}`;
  const rows = [
    ...data.byFund.map((f) => ({ key: 'f:' + f.fund, name: FUNDS[f.fund]?.label || f.fund, ...f.metrics })),
    ...data.byMarket.map((m) => ({ key: 'm:' + m.marketId, name: marketLabel(m.marketId), ...m.metrics })),
    { key: 'total', name: 'Portfolio', ...s },
  ];
  const marketDelta = (id) => (data.deltas.byMarket.find((x) => x.marketId === id) || {}).delta || {};
  return (
    <div className={presentation ? 'present' : ''}>
      <div className="figures">
        <Figure label="Total beds" value={fmtInt(s.beds)} delta={d.beds} hint={vs} />
        <Figure label={future ? 'Beds leased' : 'Occupied'} value={fmtInt(s.occupied)} delta={d.occupied} hint={vs} />
        <Figure label={future ? 'Pre-lease' : 'Occupancy'} value={fmtPct(s.occPct)} delta={d.occPct} deltaKind="pct" hint={vs} warn={s.occPct != null && s.occPct < 0.85 && !future} />
        <Figure label="Financial occupancy" value={fmtPct(s.finOccPct)} hint={future ? 'to date' : null} />
        <Figure label="Monthly revenue" value={fmtMoney(s.monthly)} delta={d.monthly} deltaKind="money" hint={vs} />
      </div>
      <Disclosure summary="Rollups by fund and market, occupied by lease type, short-term and commercial" defaultOpen={presentation}>
        <div className="toolbar"><span className="muted">{future ? `A future year: figures are pre-lease to date, compared with the full AY ${ayShort(data.ay - 1)}. The Weekly view compares against the same point last year.` : 'Pro-forma = Executed + In Process.'}</span><Button small onClick={() => downloadCSV(`summary-${sel.ay}-${sel.basis}.csv`, toCSV(rows, M_COLS))}>CSV</Button></div>
        <DataGrid columns={M_COLS} rows={rows} rowKey="key" height={Math.min(560, 44 + rows.length * 40) + 'px'} />
        <div className="two-col">
          <table className="mini"><caption>Occupied beds by lease type</caption><tbody>
            <tr><th>Whole house</th><td>{fmtInt(s.byType.WH)}</td></tr><tr><th>Unit</th><td>{fmtInt(s.byType.UNIT)}</td></tr><tr><th>Bedroom</th><td>{fmtInt(s.byType.BED)}</td></tr>
            {s.carriedBeds > 0 && <tr><th>of which carried from a two-year lease</th><td>{fmtInt(s.carriedBeds)}</td></tr>}
          </tbody></table>
          <table className="mini"><caption>Outside the student denominator</caption><tbody>
            <tr><th>Short-term rental beds</th><td>{fmtInt(data.str.beds)} ({fmtPct(data.str.occPct)} occupied, {fmtMoney(data.str.monthly)}/mo)</td></tr>
            <tr><th>Commercial, land, office</th><td>{fmtMoney(data.commercial.monthly)}/mo, no beds</td></tr>
            {s.targetMonthly > 0 && <tr><th>Versus target (monthly)</th><td>{fmtDelta(s.targetVariance, 'money')} on {fmtMoney(s.targetMonthly)}</td></tr>}
          </tbody></table>
        </div>
        <table className="mini wide"><caption>By market versus last academic year</caption><thead><tr><th>Market</th><th>Occupied</th><th>Δ beds</th><th>Occ.</th><th>Δ pt</th><th>Rent/bed</th><th>Δ $</th></tr></thead><tbody>
          {data.byMarket.map((m) => { const dm = marketDelta(m.marketId); return <tr key={m.marketId}><th>{marketLabel(m.marketId)}</th><td>{fmtInt(m.metrics.occupied)}</td><td>{fmtDelta(dm.occupied)}</td><td>{fmtPct(m.metrics.occPct)}</td><td>{fmtDelta(dm.occPct, 'pct')}</td><td>{fmtMoney(m.metrics.rentPerBed)}</td><td>{fmtDelta(dm.rentPerBed, 'money')}</td></tr>; })}
        </tbody></table>
      </Disclosure>
      {data.degraded && data.degraded.length > 0 && <p className="muted small">Off because a field is missing: {data.degraded.map((x) => x.feature || x.field).join(', ')}.</p>}
    </div>
  );
}

export function Portfolio({ sel, density }) {
  const { data, error, loading } = useRoute('portfolio', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  const [open, setOpen] = useState(() => new Set());
  const [level, setLevel] = useState(2); // expand-to-level default: funds + markets open
  const [vacancyOnly, setVacancyOnly] = useState(false);
  const [q, setQ] = useState('');
  const nodes = data ? data.nodes : [];
  const visible = useMemo(() => {
    if (!nodes.length) return [];
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const needle = q.trim().toLowerCase();
    const matches = (n) => (!needle || n.name.toLowerCase().includes(needle)) && (!vacancyOnly || n.metrics.vacant > 0 || n.kind === 'fund');
    const keep = new Set();
    for (const n of nodes) if (matches(n) && (needle || vacancyOnly) ) { let k = n.key; while (k) { keep.add(k); k = byKey.get(k)?.parent; } }
    const isOpen = (n) => (needle ? true : open.has(n.key) ? !open.get : open.has('!' + n.key) ? false : n.depth < level);
    const out = []; const closed = new Set();
    for (const n of nodes) {
      if (n.parent && closed.has(n.parent)) { closed.add(n.key); continue; }
      if ((needle || vacancyOnly) && !keep.has(n.key)) { closed.add(n.key); continue; }
      out.push(n);
      const o = needle ? true : (open.has('+' + n.key) ? true : open.has('-' + n.key) ? false : n.depth < level);
      if (!o) closed.add(n.key);
    }
    return out;
  }, [nodes, open, level, vacancyOnly, q]);
  const toggle = (n) => { const next = new Set(open); const isOpenNow = next.has('+' + n.key) ? true : next.has('-' + n.key) ? false : n.depth < level; next.delete('+' + n.key); next.delete('-' + n.key); next.add((isOpenNow ? '-' : '+') + n.key); setOpen(next); };
  const cols = [
    { key: 'name', label: 'Fund ▸ Market ▸ Property ▸ Unit ▸ Bedroom', width: 320, render: (v, n) => <span className="tree-cell" style={{ paddingLeft: n.depth * 16 }}>{n.childCount ? <button type="button" className="tree-toggle" onClick={(e) => { e.stopPropagation(); toggle(n); }} aria-label="Toggle">{visible.some((x) => x.parent === n.key) ? '▾' : '▸'}</button> : <span className="tree-leaf" />}<span className={`kind-${n.kind}`}>{v}</span>{n.segment && n.segment !== 'STUDENT' && <span className="pill pill-muted">{n.segment.toLowerCase()}</span>}</span> },
    ...M_COLS.slice(1),
  ];
  const flat = (n) => ({ ...n, ...n.metrics });
  const rows = visible.map(flat);
  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder="Filter by name (ancestors kept)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter portfolio" />
        <Toggle label="Vacancy only" checked={vacancyOnly} onChange={setVacancyOnly} />
        <Select label="Expand to" value={level} onChange={(v) => { setLevel(Number(v)); setOpen(new Set()); }} options={[{ value: 1, label: 'Funds' }, { value: 2, label: 'Markets' }, { value: 3, label: 'Properties' }, { value: 4, label: 'Units' }, { value: 5, label: 'Bedrooms' }]} />
        <Button small onClick={() => { setLevel(5); setOpen(new Set()); }}>Expand all</Button>
        <Button small onClick={() => { setLevel(1); setOpen(new Set()); }}>Collapse all</Button>
        <Button small onClick={() => downloadCSV(`portfolio-${sel.ay}-${sel.basis}.csv`, toCSV(nodes.map(flat), [{ key: 'kind', label: 'Level' }, { key: 'name', label: 'Name' }, ...M_COLS.slice(1)]))}>CSV (all levels)</Button>
        <span className="muted">{fmtInt(nodes.length)} nodes</span>
      </div>
      <DataGrid columns={cols} rows={rows} rowKey="key" loading={loading} density={density} empty={{ title: 'No rows match', body: 'Clear the filter or switch off "Vacancy only".' }} />
    </div>
  );
}

export function Weekly({ sel }) {
  const [week, setWeek] = useState('');
  const { data, error, loading } = useRoute('weekly', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market, week });
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Skeleton rows={5} />;
  const P = data.panels;
  const panel = (title, p, extra) => (
    <section className="panel" key={title}>
      <h3>{title} <span className="muted small">{fmtDate(p.start)}–{fmtDate(p.end)} vs {fmtDate(p.lastStart)}–{fmtDate(p.lastEnd)}{p.elapsedDays < 7 && title === 'This week' ? ` (${p.elapsedDays} elapsed days)` : ''}</span></h3>
      <table className="mini wide"><thead><tr><th></th><th>This year</th><th>Last year</th><th>Change</th></tr></thead><tbody>
        <tr><th>Beds leased</th><td>{fmtInt(p.thisYear.bedsLeased)}</td><td>{fmtInt(p.lastYear.bedsLeased)}</td><td>{fmtDelta(p.change.bedsLeased)}</td></tr>
        <tr><th>Leases sent</th><td>{fmtInt(p.thisYear.leasesSent)}</td><td>{fmtInt(p.lastYear.leasesSent)}</td><td>{fmtDelta(p.change.leasesSent)}</td></tr>
        <tr><th>Revenue leased (annual)</th><td>{fmtMoney(p.thisYear.revenueLeased)}</td><td>{fmtMoney(p.lastYear.revenueLeased)}</td><td>{fmtDelta(p.change.revenueLeased, 'money')}</td></tr>
        {extra}
      </tbody></table>
    </section>
  );
  const xLabels = data.pace.filter((_, i) => i % Math.ceil(data.pace.length / 6) === 0).map((pt) => ({ i: data.pace.indexOf(pt), text: fmtDate(pt.weekStart) }));
  return (
    <div>
      <div className="toolbar"><label className="field"><span className="field-label">Week of</span><input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></label>{week && <Button small onClick={() => setWeek('')}>This week</Button>}<span className="muted">Last year shifted {data.shiftDays} days so Mon–Sun aligns with Mon–Sun.</span></div>
      <div className="panels">
        {panel('This week', P.week)}
        {panel('This month', P.month)}
        {panel(`AY ${ayShort(data.ay)} to date`, P.ay, <tr><th>Pre-lease</th><td>{fmtPct(P.ay.preleasePct)}</td><td>{fmtPct(P.ay.preleasePctLast)}</td><td>{fmtDelta(P.ay.preleasePct - P.ay.preleasePctLast, 'pct')}</td></tr>)}
      </div>
      <section className="panel">
        <h3>Leasing pace <span className="muted small">cumulative beds signed, by week</span></h3>
        <LineChart series={[{ name: `AY ${ayShort(data.ay)}`, values: data.pace.map((p) => p.thisYear) }, { name: `AY ${ayShort(data.ay - 1)} aligned`, values: data.pace.map((p) => p.lastYear) }]} xLabels={xLabels} yLabel="beds" />
      </section>
      <section className="panel">
        <h3>By market, this week</h3>
        <table className="mini wide"><thead><tr><th>Market</th><th>Beds leased</th><th>Last year</th><th>Δ</th><th>Leases sent</th><th>Last year</th><th>Δ</th></tr></thead><tbody>
          {data.byMarket.map((m) => <tr key={m.marketId}><th>{marketLabel(m.marketId)}</th><td>{fmtInt(m.thisYear.bedsLeased)}</td><td>{fmtInt(m.lastYear.bedsLeased)}</td><td>{fmtDelta(m.change.bedsLeased)}</td><td>{fmtInt(m.thisYear.leasesSent)}</td><td>{fmtInt(m.lastYear.leasesSent)}</td><td>{fmtDelta(m.change.leasesSent)}</td></tr>)}
        </tbody></table>
      </section>
      <p className="recon"><strong>Not yet dated:</strong> {fmtInt(data.undated.noSigned)} counted leases ({fmtInt(data.undated.noSignedBeds)} beds) have no signed date and {fmtInt(data.undated.noSent)} have no sent date, so they land in no week. Summary counts them; the panels above cannot.</p>
    </div>
  );
}
