import { useMemo, useState } from 'react';
import { useRoute } from '../../hooks.js';
import { DataGrid } from '../../components/DataGrid/DataGrid.jsx';
import { Button, Toggle, Select, ErrorBox, Tile } from '../../ui.jsx';
import { fmtInt, fmtMoney, fmtPct, ayShort, toCSV, downloadCSV } from '../../format.js';
import { REPORT_TYPES, columnGroups, BASE_COLS } from './columns.jsx';

/** Leasing Details (v2): one Fund ▸ Market ▸ Property ▸ Unit ▸ Bedroom tree; the report type picks the column groups. */
export function Portfolio({ sel, density, rt, setRt }) {
  const { data, error, loading } = useRoute('portfolio', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market });
  const [open, setOpen] = useState(() => new Set());
  const [level, setLevel] = useState(2);
  const [desc, setDesc] = useState(false);
  const [q, setQ] = useState('');
  const report = REPORT_TYPES.find((r) => r.key === rt) || REPORT_TYPES[0];
  const vacancyOnly = !!report.vac;
  const nodes = data ? data.nodes : [];
  const cur = ayShort(sel.ay), ly = data && data.priorAy ? ayShort(data.priorAy) : 'Prior AY';
  const groups = useMemo(() => columnGroups(cur, ly), [cur, ly]);
  const visible = useMemo(() => {
    if (!nodes.length) return [];
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const needle = q.trim().toLowerCase();
    const matches = (n) => (!needle || n.name.toLowerCase().includes(needle)) && (!vacancyOnly || n.metrics.vacant > 0);
    const keep = new Set();
    if (needle || vacancyOnly) for (const n of nodes) if (matches(n)) { let k = n.key; while (k) { keep.add(k); k = byKey.get(k)?.parent; } }
    const out = []; const closed = new Set();
    for (const n of nodes) {
      if (n.parent && closed.has(n.parent)) { closed.add(n.key); continue; }
      if ((needle || vacancyOnly) && !keep.has(n.key)) { closed.add(n.key); continue; }
      out.push(n);
      const o = needle ? true : open.has('+' + n.key) ? true : open.has('-' + n.key) ? false : n.depth < level;
      if (!o) closed.add(n.key);
    }
    return out;
  }, [nodes, open, level, vacancyOnly, q]);
  const toggle = (n) => { const next = new Set(open); const isOpenNow = next.has('+' + n.key) ? true : next.has('-' + n.key) ? false : n.depth < level; next.delete('+' + n.key); next.delete('-' + n.key); next.add((isOpenNow ? '-' : '+') + n.key); setOpen(next); };
  const dataCols = useMemo(() => [...BASE_COLS, ...report.groups.flatMap((g) => groups[g])], [report, groups]);
  const cols = useMemo(() => [
    { key: 'name', label: 'Fund ▸ Market ▸ Property ▸ Unit ▸ Bedroom', width: 320, note: 'Expand a row for its children', render: (v, n) => <span className="tree-cell" style={{ paddingLeft: n.depth * 16 }}>{n.childCount ? <button type="button" className="tree-toggle" onClick={(e) => { e.stopPropagation(); toggle(n); }} aria-label="Toggle">{visible.some((x) => x.parent === n.key) ? '▾' : '▸'}</button> : <span className="tree-leaf" />}<span className={`kind-${n.kind}`}>{v}</span>{n.segment && n.segment !== 'STUDENT' && <span className="pill pill-muted">{n.segment.toLowerCase()}</span>}{n.leaf && n.leaf.carried && <span className="pill pill-muted" title="Year 2 of a two-year lease">yr 2</span>}{n.leaf && n.leaf.ss && <span className="pill pill-muted" title="Same-store: 100% leased both years">ss</span>}</span> },
    ...dataCols,
  ], [dataCols, visible]); // eslint-disable-line
  const flat = (n) => ({ ...n, ...n.metrics, occChange: n.metrics.pOccupied != null || n.metrics.occupied ? (n.metrics.occupied || 0) - (n.metrics.pOccupied || 0) : null });
  const rows = visible.map(flat);
  if (error) return <ErrorBox error={error} />;
  const t = data ? data.total : null, v = data ? data.vacancy : null;
  return (
    <div>
      <div className="toolbar wrap">
        <Select label="Report" value={report.key} onChange={(k) => setRt(k)} options={REPORT_TYPES.map((r) => ({ value: r.key, label: r.label }))} />
        <span className="muted small rt-note">{report.note}</span>
        <input className="search" placeholder="Find property…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find property" />
        <Select label="Expand to" value={level} onChange={(x) => { setLevel(Number(x)); setOpen(new Set()); }} options={[{ value: 1, label: 'Funds' }, { value: 2, label: 'Markets' }, { value: 3, label: 'Properties' }, { value: 4, label: 'Units' }, { value: 5, label: 'Bedrooms' }]} />
        <Button small onClick={() => { setLevel(5); setOpen(new Set()); }}>Expand all</Button>
        <Button small onClick={() => { setLevel(1); setOpen(new Set()); }}>Collapse all</Button>
        <Toggle label="Descriptions" checked={desc} onChange={setDesc} />
        <Button small onClick={() => downloadCSV(`leasing-details-${report.key}-${sel.ay}-${sel.basis}.csv`, toCSV(nodes.map(flat), [{ key: 'kind', label: 'Level' }, { key: 'name', label: 'Name' }, ...dataCols]))}>Export CSV</Button>
        <span className="muted small">{fmtInt(nodes.length)} rows · {data ? fmtInt(data.propertyCount) : '…'} properties</span>
      </div>
      {desc && <div className="col-notes small"><strong>Columns.</strong> {dataCols.filter((c) => c.note).map((c) => <span key={c.key}><b>{c.label}</b>: {c.note}. </span>)}</div>}
      {vacancyOnly && t && <div className="tiles four inset">
        <Tile label="Vacant Beds" value={fmtInt(t.vacant)} note={`of ${fmtInt(t.beds)} beds · ${fmtPct(t.vacPct)}`} />
        <Tile label="Fully Vacant Units" value={fmtInt(v.fullUnits)} note={`${fmtInt(v.fullBeds)} beds, no counted lease`} />
        <Tile label="Partly Vacant Units" value={fmtInt(v.partUnits)} note={`${fmtInt(v.partBeds)} vacant beds`} />
        <Tile label="Vacant Target Rent" value={fmtMoney(t.tgtVacant)} note="Monthly target on vacant beds" />
      </div>}
      {report.key === 'rent' && data && data.sameStore && <p className="muted small">Same-store: {fmtInt(data.sameStore.grains)} grains · {fmtInt(data.sameStore.beds)} beds. Dropped: {fmtInt(data.sameStore.dropped.excluded)} with an excluded lease, {fmtInt(data.sameStore.dropped.vacantCur)} not 100% leased this year, {fmtInt(data.sameStore.dropped.vacantPrior)} not 100% leased last year.</p>}
      <DataGrid columns={cols} rows={rows} rowKey="key" loading={loading} density={density} empty={{ title: 'No rows match', body: vacancyOnly ? 'Nothing in scope has a vacant bed.' : 'Clear the filter.' }} />
    </div>
  );
}
