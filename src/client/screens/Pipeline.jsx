import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../hooks.js';
import { api, post, invalidate, recordUrl, isPreview } from '../api.js';
import { DataGrid } from '../components/DataGrid/DataGrid.jsx';
import { Button, Select, Pill, ErrorBox, Dot, cx } from '../ui.jsx';
import { fmtInt, fmtMoney, fmtDate, toCSV, downloadCSV } from '../format.js';
import { STAGES, stageByKey, STAGE_OWNER, UAS, MARKETS } from '../../shared/constants.js';
import { pickerStages } from '../../shared/rules/stages.js';
import { SavedViews } from './SavedViews.jsx';

const PICKER = pickerStages().map((s) => ({ value: s.key, label: s.label }));
const stageTone = (k) => (k === 'FULLY_EXECUTED' ? 'done' : k === 'LEASE_OUT' ? 'pending' : k === 'OFFLINE' || k === 'RENEWAL_DECLINED' ? 'warn' : k === 'NONE' ? 'muted' : 'active');
export function StagePill({ stageKey, days }) { const s = stageByKey(stageKey); return <span className={cx('pill', `pill-${stageTone(stageKey)}`)} title={s.owner === STAGE_OWNER.LEASE ? 'Lease-driven: set by the lease record' : ''}>{s.label}{stageKey !== 'NONE' && days != null && days > 0 && <span className="pill-days"> · {days}d</span>}</span>; }

export function Pipeline({ sel, setSel, density, isMobile, bootstrap }) {
  const [view, setView] = useState({ stage: '', availability: '', tours: '', q: sel.q || '', sort: 'property', dir: 'asc', page: 0, pageSize: 100 });
  useEffect(() => { setView((v) => ({ ...v, q: sel.q || '', page: 0 })); }, [sel.q]);
  const params = { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market, ...view };
  const { data, error, loading } = useRoute('pipeline', params);
  const [edits, setEdits] = useState({});
  const [results, setResults] = useState({});
  const [selection, setSelection] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const dirtyCount = Object.keys(edits).length;
  useEffect(() => { const h = (e) => { if (dirtyCount) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirtyCount]);
  const onEdit = (k, field, value, problem) => { setEdits((e) => ({ ...e, [k]: { ...(e[k] || {}), [field]: value } })); if (problem) setResults((r) => ({ ...r, [k]: { ok: false, message: problem } })); else setResults((r) => { const n = { ...r }; delete n[k]; return n; }); };
  const revert = () => { setEdits({}); setResults({}); };
  const save = async () => {
    const rows = data ? data.rows : [];
    const changes = Object.entries(edits).map(([k, fields]) => { const row = rows.find((r) => r.key === k); return { changeId: `${k}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, recordType: UAS.TYPE, recordId: row?.rowId, version: row?.version, fields: Object.fromEntries(Object.entries(fields).map(([f, v]) => [FIELD_MAP[f] || f, f === 'stage' ? stageByKey(v).label : v])), key: k }; });
    if (!changes.length) return;
    setSaving(true);
    const res = await post('write', { changes: changes.map(({ key, ...c }) => c) });
    const byChange = new Map((res.results || []).map((r) => [r.changeId, r]));
    const nextEdits = { ...edits }, nextResults = { ...results };
    for (const c of changes) { const r = byChange.get(c.changeId); if (r && r.ok) { delete nextEdits[c.key]; nextResults[c.key] = { ok: true }; } else nextResults[c.key] = { ok: false, message: r ? r.message : (res.deferred || []).includes(c.changeId) ? 'Deferred: governance limit reached, try again' : 'No response' }; }
    setEdits(nextEdits); setResults(nextResults); setSaving(false);
    if (Object.keys(nextEdits).length < changes.length) invalidate('pipeline');
  };
  const applyToSelected = (field, value) => { setEdits((e) => { const n = { ...e }; for (const k of selection) n[k] = { ...(n[k] || {}), [field]: value }; return n; }); };
  const rows = data ? data.rows : [];
  const columns = useMemo(() => [
    { key: 'property', label: 'Property', width: 200, render: (v, r) => <a className="link" href={recordUrl('property', r.propertyId)} target="_blank" rel="noreferrer">{v}</a> },
    { key: 'unit', label: 'Unit', width: 150, render: (v, r) => r.unitId ? <a className="link" href={recordUrl('unit', r.unitId)} target="_blank" rel="noreferrer">{v}</a> : v },
    { key: 'beds', label: 'Beds', type: 'number', width: 64 },
    { key: 'free', label: 'Free', type: 'number', width: 64, title: (v, r) => `${r.taken} taken of ${r.beds}`, render: (v, r) => <span className={cx(v === 0 && 'muted', v > 0 && r.stage === 'NONE' && 'warn-text')}>{v}</span> },
    { key: 'stage', label: 'Stage', width: 230, type: 'select', options: PICKER, editable: (r) => r.rowId && r.stageSource !== 'lease', render: (v, r) => <StagePill stageKey={v} days={r.daysInStage} /> },
    { key: 'tours', label: 'Tours', type: 'number', width: 70, render: (v, r) => <span className="tours"><Dot level={v === 0 ? 0 : v < 3 ? 1 : 2} />{v}{r.lastTour && <span className="muted small"> {fmtDate(r.lastTour)}</span>}</span> },
    { key: 'targetMonthly', label: 'Target', unit: '$/mo', type: 'money', width: 116, title: (v, r) => (r.targetPerBed ? `${fmtMoney(r.targetPerBed)} per bed` : 'no target for this AY') },
    { key: 'lastOffer', label: 'Last offer', unit: '$/bed', type: 'money', width: 124, editable: (r) => !!r.rowId, validate: (v) => (v != null && v < 0 ? 'Offer cannot be negative' : null) },
    { key: 'expectedTenants', label: 'Expected tenants', width: 200, type: 'text', editable: (r) => !!r.rowId },
    { key: 'followup', label: 'Follow-up', width: 120, type: 'date', editable: (r) => !!r.rowId },
    { key: 'leases', label: 'Lease', width: 220, sortable: false, render: (v, r) => v.length ? v.map((l) => <a key={l.id} className={cx('link', !l.placed && 'struck')} href={recordUrl('lease', l.id)} target="_blank" rel="noreferrer" title={`${l.type} · ${l.status}${l.code ? ' · ' + l.code : ''}`}>{l.name}</a>).reduce((a, b) => [a, ' · ', b]) : <span className="muted">—</span> },
    { key: 'leaseType', label: 'Type', width: 70, value: (r) => (r.leases[0] ? r.leases[0].type : ''), sortable: false },
    { key: 'notes', label: 'Notes', width: 220, type: 'text', editable: false, render: (v) => <span className="muted">{v}</span> },
  ], []);
  const onSort = (key) => setView((v) => ({ ...v, sort: SORT_KEY[key] || key, dir: v.sort === (SORT_KEY[key] || key) && v.dir === 'asc' ? 'desc' : 'asc', page: 0 }));
  const sortState = { key: Object.keys(SORT_KEY).find((k) => SORT_KEY[k] === view.sort) || view.sort, dir: view.dir };
  const stageCounts = data ? data.stageCounts : {};
  const card = (r, e) => (
    <div className="card-body" key={r.key}>
      <div className="card-top"><strong>{r.unit === '(whole property)' ? r.property : `${r.property} · ${r.unit}`}</strong><StagePill stageKey={e.stage || r.stage} days={r.daysInStage} /></div>
      <div className="card-row muted">{r.beds} beds · {r.free} free · {r.targetMonthly ? fmtMoney(r.targetMonthly) + '/mo target' : 'no target'} · tours {r.tours}</div>
      <div className="card-row">
        <label className="field"><span className="field-label">Stage</span><select value={e.stage || r.stage} disabled={!r.rowId || r.stageSource === 'lease'} onChange={(ev) => onEdit(r.key, 'stage', ev.target.value)}>{PICKER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="field"><span className="field-label">Follow-up</span><input type="date" value={e.followup ?? r.followup ?? ''} disabled={!r.rowId} onChange={(ev) => onEdit(r.key, 'followup', ev.target.value)} /></label>
      </div>
    </div>
  );
  return (
    <div className="screen">
      <div className="toolbar wrap">
        <Select label="Stage" value={view.stage} onChange={(v) => setView({ ...view, stage: v, page: 0 })} options={[{ value: '', label: `All (${fmtInt(data?.total)})` }, ...STAGES.map((s) => ({ value: s.key, label: `${s.label} (${stageCounts[s.key] || 0})` }))]} />
        <Select label="Availability" value={view.availability} onChange={(v) => setView({ ...view, availability: v, page: 0 })} options={[{ value: '', label: 'Any' }, { value: 'free', label: 'Has free beds' }, { value: 'full', label: 'Fully taken' }]} />
        <Select label="Tours" value={view.tours} onChange={(v) => setView({ ...view, tours: v, page: 0 })} options={[{ value: '', label: 'Any' }, { value: 'none', label: 'No tours' }, { value: 'some', label: 'Has tours' }]} />
        <SavedViews workspace="pipeline" state={view} onApply={(s) => setView({ ...view, ...s, page: 0 })} />
        <Button small onClick={() => api('pipeline', { ...params, page: 0, pageSize: 500 }).then((d) => downloadCSV(`pipeline-${sel.ay}.csv`, toCSV(d.rows, columns.filter((c) => c.key !== 'leases').concat([{ key: 'leases', label: 'Leases', value: (r) => r.leases.map((l) => l.name).join('; ') }]))))}>CSV</Button>
        {data && <span className="muted">{fmtInt(data.total)} units · {fmtInt(data.totalBeds)} beds</span>}
      </div>
      {selection.size > 0 && <div className="bulkbar"><span>{selection.size} selected</span><Select label="Set stage" value="" onChange={(v) => v && applyToSelected('stage', v)} options={[{ value: '', label: '…' }, ...PICKER]} /><Button small onClick={() => setSelection(new Set())}>Clear</Button></div>}
      {error ? <ErrorBox error={error} /> : (
        <DataGrid columns={columns} rows={rows} rowKey="key" edits={edits} onEdit={onEdit} results={results} selection={selection} onSelectionChange={setSelection} sort={sortState} onSort={onSort} loading={loading} density={density} isMobile={isMobile} cardRenderer={card}
          empty={{ title: 'No units match these filters', body: 'Widen the stage or availability filter, or clear the search.' }}
          footer={data && data.total > view.pageSize && <div className="pager"><Button small disabled={view.page === 0} onClick={() => setView({ ...view, page: view.page - 1 })}>‹ Prev</Button><span>{view.page * view.pageSize + 1}–{Math.min(data.total, (view.page + 1) * view.pageSize)} of {fmtInt(data.total)}</span><Button small disabled={(view.page + 1) * view.pageSize >= data.total} onClick={() => setView({ ...view, page: view.page + 1 })}>Next ›</Button></div>} />
      )}
      {dirtyCount > 0 && <div className="savebar" role="status"><span>{dirtyCount} unsaved {dirtyCount === 1 ? 'row' : 'rows'}{isPreview() && ' · preview mode: nothing is written'}</span><Button small onClick={revert}>Revert</Button><Button kind="primary" small disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></div>}
    </div>
  );
}
const FIELD_MAP = { stage: UAS.STAGE, lastOffer: UAS.LAST_OFFER, expectedTenants: UAS.EXPECTED_TENANTS, followup: UAS.FOLLOWUP };
const SORT_KEY = { targetMonthly: 'target', free: 'available' };
