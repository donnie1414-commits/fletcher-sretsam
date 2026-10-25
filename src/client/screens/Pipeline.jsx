import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoute } from '../hooks.js';
import { api, post, invalidate, recordUrl, isPreview } from '../api.js';
import { DataGrid } from '../components/DataGrid/DataGrid.jsx';
import { Button, Select, Pill, ErrorBox, Dot, Toggle, Stat, cx } from '../ui.jsx';
import { fmtInt, fmtMoney, fmtPct, fmtDate, toCSV, downloadCSV } from '../format.js';
import { STAGES, stageByKey, STAGE_OWNER, UAS } from '../../shared/constants.js';
import { pickerStages, funnel } from '../../shared/rules/stages.js';
import { UNIT_BEDS, HOUSE_BEDS } from '../../shared/rules/views.js';
import { SavedViews } from './SavedViews.jsx';
import { HistoryDrawer, UnitHistory } from './pipeline/HistoryDrawer.jsx';
import { NotesDrawer } from './pipeline/NotesDrawer.jsx';
import { LeaseDialog } from './pipeline/LeaseDialog.jsx';

const PICKER = pickerStages().map((s) => ({ value: s.key, label: s.label }));
/** One muted colour per stage (CSS .st-<KEY>), shared by the pills, the distribution bar and the legend. */
export function StagePill({ stageKey, days }) { const s = stageByKey(stageKey); return <span className={cx('pill', 'pill-stage', `st-${stageKey}`)} title={s.owner === STAGE_OWNER.LEASE ? 'Lease-driven: set by the lease record' : ''}><i className="st-dot" aria-hidden="true" />{s.label}{stageKey !== 'NONE' && days != null && days > 0 && <span className="pill-days"> · {days}d</span>}</span>; }
const FIELD_MAP = { stage: UAS.STAGE, lastOffer: UAS.LAST_OFFER, expectedTenants: UAS.EXPECTED_TENANTS, followup: UAS.FOLLOWUP };
const SORT_KEY = { targetMonthly: 'target', free: 'available', unit: 'unit', propertyBeds: 'propertyBeds' };
const CHUNK = 50;

/**
 * §6.3 Pipeline: one row per leasable unit (the KPI denominator), inline edits with autosave (debounced, chunked at 50,
 * one request in flight), stage band + distribution bar, needs-action / beds-available / mentions-me / below-settle
 * filters, a leasing-history drawer per row, a notes thread with @mentions, and the lease dialog.
 */
export function Pipeline({ sel, setSel, density, isMobile, bootstrap }) {
  const [view, setView] = useState({ stage: '', availability: '', unitBeds: '', houseBeds: '', needsAction: '', mentions: '', breach: '', q: sel.q || '', sort: 'property', dir: 'asc', page: 0, pageSize: 100 });
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (k) => setExpanded((x) => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n; });
  useEffect(() => { setView((v) => ({ ...v, q: sel.q || '', page: 0 })); }, [sel.q]);
  const params = { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market, ...view };
  const { data, error, loading } = useRoute('pipeline', params);
  const [edits, setEdits] = useState({});
  const [results, setResults] = useState({});
  const [selection, setSelection] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [auto, setAuto] = useState(true);
  const [msg, setMsg] = useState('');
  const [drawer, setDrawer] = useState(null); // { kind: 'history'|'notes'|'lease', row }
  const timer = useRef(null); const again = useRef(false);
  const dirtyCount = Object.keys(edits).length;
  useEffect(() => { const h = (e) => { if (dirtyCount) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirtyCount]);
  const rows = data ? data.rows : [];
  const ayId = (bootstrap.academicYears.find((a) => a.year === sel.ay) || {}).id;

  const save = async (only = null) => {
    if (saving) { again.current = true; return; }
    const pending = Object.entries(edits).filter(([k]) => !only || only === k);
    if (!pending.length) return;
    const mk = ([k, fields]) => { const row = rows.find((r) => r.key === k) || {}; const f = {}; for (const [name, v] of Object.entries(fields)) f[FIELD_MAP[name] || name] = name === 'stage' ? stageByKey(v).label : v; return { key: k, change: { changeId: `${k}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, recordType: UAS.TYPE, recordId: row.rowId || null, version: row.version, fields: row.rowId ? f : { ...f, name: `${row.unit} — AY ${sel.ay}-${sel.ay + 1}`, [UAS.UNIT]: Number(row.unitId), [UAS.AY]: Number(ayId), [UAS.PROPERTY]: Number(row.propertyId), [UAS.STAGE_SOURCE]: 1 } } }; };
    setSaving(true); setMsg(pending.length > CHUNK ? `Saving 1–${CHUNK} of ${pending.length}…` : 'Saving…');
    const sent = Object.fromEntries(pending.map(([k, f]) => [k, JSON.stringify(f)]));
    let done = 0, failed = 0, held = 0;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const slice = pending.slice(i, i + CHUNK).map(mk);
      if (i) setMsg(`Saving ${i + 1}–${Math.min(pending.length, i + CHUNK)} of ${pending.length}…`);
      let res; try { res = await post('write', { changes: slice.map((x) => x.change) }); } catch (e) { setMsg(`Could not reach NetSuite: ${e.message}. Your edits are still here — use Save now once you are back online.`); setSaving(false); return; }
      const byChange = new Map((res.results || []).map((r) => [r.changeId, r]));
      setEdits((cur) => { const next = { ...cur }; const nr = {}; for (const x of slice) { const r = byChange.get(x.change.changeId); const stale = JSON.stringify(cur[x.key] || {}) !== sent[x.key]; if (r && r.ok) { done++; if (stale) held++; else delete next[x.key]; nr[x.key] = { ok: true }; } else { failed++; nr[x.key] = { ok: false, message: r ? `${r.message}${r.code === 'STALE' ? ' — reload the tab' : ''}` : (res.deferred || []).includes(x.change.changeId) ? 'Deferred: governance limit reached, try again' : 'No response' }; } } setResults((rr) => ({ ...rr, ...nr })); return next; });
      if (res.deferred && res.deferred.length) break;
    }
    setMsg(done ? `Saved ${done} ${done === 1 ? 'row' : 'rows'} at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.${failed ? ` ${failed} could not be saved — see the rows marked.` : ''}${held ? ` ${held} changed again and will go next.` : ''}` : failed ? `${failed} ${failed === 1 ? 'row was' : 'rows were'} not saved.` : 'Nothing to save.');
    setSaving(false);
    if (done) invalidate('pipeline');
    if (again.current) { again.current = false; queue(); }
  };
  const queue = () => { if (!auto) return; if (timer.current) clearTimeout(timer.current); setMsg('Autosaving…'); timer.current = setTimeout(() => { timer.current = null; save(); }, 1200); };
  const onEdit = (k, field, value, problem) => {
    setEdits((e) => { const row = rows.find((r) => r.key === k) || {}; const base = field === 'stage' ? row.stage : row[field]; const cur = { ...(e[k] || {}) }; if (String(value ?? '') === String(base ?? '')) delete cur[field]; else cur[field] = value; const n = { ...e }; if (Object.keys(cur).length) n[k] = cur; else delete n[k]; return n; });
    if (problem) setResults((r) => ({ ...r, [k]: { ok: false, message: problem } })); else setResults((r) => { const n = { ...r }; delete n[k]; return n; });
    // Ready For Lease: ask for the terms there and then, while whoever agreed them still has them in their head
    if (field === 'stage' && value === 'READY_FOR_LEASE') { const row = rows.find((r) => r.key === k); if (row && !row.leases.length && !row.leaseTerms && row.unitId) setDrawer({ kind: 'lease', row }); }
    if (!problem) queue();
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const revert = () => { setEdits({}); setResults({}); setMsg(''); };
  const applyToSelected = (field, value) => { setEdits((e) => { const n = { ...e }; for (const k of selection) { const row = rows.find((r) => r.key === k); if (row && row.editable) n[k] = { ...(n[k] || {}), [field]: value }; } return n; }); queue(); };

  const stageOf = (r) => (edits[r.key] && edits[r.key].stage) || r.stage;
  const columns = useMemo(() => [
    { key: 'unit', label: 'Property / Unit', width: 280, render: (v, r) => <span className="unit-cell"><button type="button" className={cx('chevbtn', expanded.has(r.key) && 'is-open')} aria-label="Leasing history" aria-expanded={expanded.has(r.key)} onClick={(e) => { e.stopPropagation(); toggleExpand(r.key); }}>▸</button><span><strong>{r.unit === '(whole property)' ? r.property : v}</strong><span className="muted small"> {r.unit === '(whole property)' ? 'whole property' : r.property} · {r.marketLabel || r.market}</span>{r.leases[0] && <span className="small"> <a className={cx('link', !r.leases[0].placed && 'struck')} href={recordUrl('lease', r.leases[0].id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.leases[0].name}</a>{r.twoYear && <Pill tone="muted" title="One lease record covering more than one academic year">yr {r.twoYear.year}/{r.twoYear.of}</Pill>}{r.leases.length > 1 && <span className="muted"> +{r.leases.length - 1}</span>}</span>}{r.draftLease && <span className="small"> <a className="link" href={recordUrl('lease', r.draftLease.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.draftLease.name}</a> <Pill tone="warn" title="No Lease Status, so it is not in the leasing statistics">no status</Pill></span>}</span></span> },
    { key: 'beds', label: 'Unit beds', type: 'number', width: 96, title: (v, r) => `${r.taken} taken of ${r.beds}${r.occupiedBy !== 'Vacant' ? ` · ${r.occupiedBy}` : ''}`, render: (v, r) => <span className="beds-cell"><strong>{v}</strong>{r.free > 0 && r.free < r.beds && <span className="muted small">{r.free} free</span>}{r.free === r.beds && r.beds > 0 && <span className="small warn-text">vacant</span>}{r.occupiedBy !== 'Vacant' && <span className={cx('tag', `tag-${r.occupiedBy.toLowerCase().replace(/\s+/g, '-')}`)}>{r.occupiedBy}</span>}</span> },
    { key: 'propertyBeds', label: 'House beds', type: 'number', width: 96, title: (v, r) => `${r.propertyUnits} unit${r.propertyUnits === 1 ? '' : 's'} at ${r.property}`, render: (v, r) => <span className="beds-cell"><strong>{v}</strong><span className="muted small">{r.propertyUnits} unit{r.propertyUnits === 1 ? '' : 's'}</span></span> },
    { key: 'stage', label: 'Leasing stage', width: 250, type: 'select', options: PICKER, editable: false, value: stageOf, render: (v, r) => <span className="stage-cell">{r.editable
      ? <Select small ariaLabel="Leasing stage" value={v} onChange={(x) => onEdit(r.key, 'stage', x)} options={PICKER} renderValue={(o) => <StagePill stageKey={o.value} />} renderOption={(o) => <StagePill stageKey={o.value} />} />
      : <><StagePill stageKey={v} days={r.daysInStage} /><span className="muted small">{r.unitId ? 'set by the lease' : 'no unit record'}</span></>}
      {r.editable && (v === 'READY_FOR_LEASE' || r.leaseTerms) && <button type="button" className="linkish small" onClick={(e) => { e.stopPropagation(); setDrawer({ kind: 'lease', row: r }); }}>{r.leaseTerms ? 'Lease terms · captured' : 'Add lease terms'}</button>}</span> },
    { key: 'daysInStage', label: 'Days in stage', type: 'number', width: 90, title: (v, r) => (r.stageDate ? `since ${fmtDate(r.stageDate)}` : 'nothing to measure'), render: (v) => (v == null ? <span className="muted">–</span> : <span className={cx('age', v >= 21 && 'stale', v >= 10 && v < 21 && 'old')}>{v}</span>) },
    { key: 'targetMonthly', label: 'Target rent', unit: '$/mo', type: 'money', width: 130, render: (v, r) => (v == null ? <span className="muted">no target</span> : <span className="tgt"><b>{fmtMoney(v)}</b><span className="muted small"> {fmtMoney(r.targetPerBed)}/bed</span>{r.vsTargetPerBed != null && Math.abs(r.vsTargetPerBed) >= 1 && <span className={cx('small', r.vsTargetPerBed > 0 ? 'delta up' : 'delta down')}> {r.vsTargetPerBed > 0 ? '+' : '−'}{fmtMoney(Math.abs(r.vsTargetPerBed))}/bed vs target</span>}</span>) },
    { key: 'lastOffer', label: 'Offered', unit: '$/bed', type: 'money', width: 104, editable: (r) => r.editable, validate: (v) => (v != null && v < 0 ? 'Offer cannot be negative' : null) },
    { key: 'monthlyRent', label: 'Signed', unit: '$/mo', type: 'money', width: 118, render: (v, r) => (v == null ? <span className="muted">–</span> : <span className="beds-cell"><strong>{fmtMoney(v)}{r.breach && <span className="bad-text" title={`Signed below the ${fmtMoney(r.settleMonthly)} settle floor`}> ▲</span>}</strong><span className="muted small">{fmtMoney(r.signedPerBed)}/bed</span></span>) },
    { key: 'expectedTenants', label: 'Expected tenants', width: 200, type: 'text', editable: (r) => r.editable, render: (v, r) => (r.editable ? <span>{v || <span className="muted">names…</span>}</span> : <span className="muted small">{r.priorTenantCount ? `${r.priorTenantCount} on the prior lease` : 'on the lease'}</span>) },
    { key: 'followup', label: 'Follow-up', width: 120, type: 'date', editable: (r) => r.editable, render: (v, r) => <span className={cx(v && v <= data?.today && r.editable && 'due')}>{v ? fmtDate(v) : <span className="muted">–</span>}</span> },
    { key: 'noteCount', label: 'Notes', width: 220, sortable: false, render: (v, r) => <button type="button" className="notebtn" onClick={(e) => { e.stopPropagation(); setDrawer({ kind: 'notes', row: r }); }}>{r.lastNote && r.lastNote.mentions.length > 0 && <span className="atb">@</span>}<span className={cx('notetext', !r.lastNote && 'none')}>{r.lastNote ? r.lastNote.text : r.notes ? r.notes : 'Add a note'}</span>{v > 0 && <span className="ncount">{v}</span>}</button> },
  ], [data && data.today, rows, edits, expanded]); // eslint-disable-line
  const onSort = (key) => setView((v) => ({ ...v, sort: SORT_KEY[key] || key, dir: v.sort === (SORT_KEY[key] || key) && v.dir === 'asc' ? 'desc' : 'asc', page: 0 }));
  const sortState = { key: Object.keys(SORT_KEY).find((k) => SORT_KEY[k] === view.sort) || view.sort, dir: view.dir };
  const stageCounts = data ? data.stageCounts : {}, stageBeds = data ? data.stageBeds : {};
  const execPct = data && data.totalBeds ? (stageBeds.FULLY_EXECUTED || 0) / data.totalBeds : null;
  const card = (r, e) => (
    <div className="card-body" key={r.key}>
      <div className="card-top"><strong>{r.unit === '(whole property)' ? r.property : `${r.property} · ${r.unit}`}</strong><StagePill stageKey={e.stage || r.stage} days={r.daysInStage} /></div>
      <div className="card-row muted">{r.beds} beds · {r.free} free · {r.targetMonthly ? fmtMoney(r.targetMonthly) + '/mo target' : 'no target'}{r.monthlyRent != null && ` · signed ${fmtMoney(r.monthlyRent)}`}</div>
      <div className="card-row">
        <label className="field"><span className="field-label">Stage</span><select value={e.stage || r.stage} disabled={!r.editable} onChange={(ev) => onEdit(r.key, 'stage', ev.target.value)}>{PICKER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="field"><span className="field-label">Follow-up</span><input type="date" value={e.followup ?? r.followup ?? ''} disabled={!r.editable} onChange={(ev) => onEdit(r.key, 'followup', ev.target.value)} /></label>
      </div>
      <div className="card-row"><Button small onClick={() => setDrawer({ kind: 'history', row: r })}>History</Button><Button small onClick={() => setDrawer({ kind: 'notes', row: r })}>Notes {r.noteCount || ''}</Button></div>
    </div>
  );
  const toggleFilter = (k) => setView((v) => ({ ...v, [k]: v[k] ? '' : '1', page: 0 }));
  return (
    <div className="screen">
      {data && <div className="pl-band">
        <Stat value={fmtInt(data.total)} label="Units" /><Stat value={fmtInt(data.totalBeds)} label="Beds" /><Stat value={fmtPct(execPct)} label="Executed" tone="ok" /><Stat value={fmtInt(stageCounts.LEASE_OUT || 0)} label="Out unsigned" tone="warn" /><Stat value={fmtInt(stageCounts.NONE || 0)} label="No stage" /><Stat value={fmtInt(stageCounts.OFFLINE || 0)} label="Offline" /><Stat value={fmtInt(data.breachCount)} label="Below settle" tone={data.breachCount ? 'bad' : ''} /><Stat value={fmtInt(data.needsActionCount)} label="Need action" tone={data.needsActionCount ? 'warn' : ''} />
        <div className="pl-bar-wrap"><div className="pl-bar">{data.totalBeds > 0 && funnel().map((s) => { const b = stageBeds[s.key] || 0; return b ? <i key={s.key} className={`st-${s.key}`} style={{ width: `${(b / data.totalBeds) * 100}%` }} title={`${s.label}: ${fmtInt(stageCounts[s.key] || 0)} units, ${fmtInt(b)} beds`} /> : null; })}</div><div className="legend small">{funnel().map((s) => <span key={s.key}><i className={`sw st-${s.key}`} />{s.label} <span className="muted">{fmtInt(stageCounts[s.key] || 0)}</span></span>)}</div></div>
      </div>}
      {data && data.missingStatusRows > 0 && <p className="muted small">{fmtInt(data.missingStatusRows)} unit{data.missingStatusRows === 1 ? ' has' : 's have'} no status record for this academic year. Saving an edit creates it.</p>}
      <div className="toolbar wrap">
        <Select label="Stage" value={view.stage} onChange={(v) => setView({ ...view, stage: v, page: 0 })} options={[{ value: '', label: `All (${fmtInt(data?.total)})` }, ...STAGES.map((s) => ({ value: s.key, label: `${s.label} (${stageCounts[s.key] || 0})` }))]} />
        <Select label="Availability" value={view.availability} onChange={(v) => setView({ ...view, availability: v, page: 0 })} options={[{ value: '', label: 'Any' }, { value: 'free', label: 'Has free beds' }, { value: 'full', label: 'Fully taken' }]} />
        <Select label="Unit beds" value={view.unitBeds} onChange={(v) => setView({ ...view, unitBeds: v, page: 0 })} options={[{ value: '', label: 'Any' }, ...UNIT_BEDS.map(([k]) => ({ value: k, label: k }))]} />
        <Select label="House beds" value={view.houseBeds} onChange={(v) => setView({ ...view, houseBeds: v, page: 0 })} options={[{ value: '', label: 'Any' }, ...HOUSE_BEDS.map(([k]) => ({ value: k, label: k }))]} />
        <Toggle label="Needs action" checked={!!view.needsAction} onChange={() => toggleFilter('needsAction')} />
        <Toggle label="Mentions me" checked={!!view.mentions} onChange={() => setView((v) => ({ ...v, mentions: v.mentions ? '' : 'me', page: 0 }))} />
        <Toggle label="Below settle" checked={!!view.breach} onChange={() => toggleFilter('breach')} />
        <SavedViews workspace="pipeline" state={view} onApply={(s) => setView({ ...view, ...s, page: 0 })} />
        <Button small onClick={() => api('pipeline', { ...params, page: 0, pageSize: 500 }).then(async (d) => { const all = [...d.rows]; for (let pg = 1; pg * 500 < d.total; pg++) all.push(...(await api('pipeline', { ...params, page: pg, pageSize: 500 })).rows); downloadCSV(`pipeline-${sel.ay}.csv`, toCSV(all, [{ key: 'property', label: 'Property' }, { key: 'unit', label: 'Unit' }, { key: 'marketLabel', label: 'Market' }, { key: 'beds', label: 'Beds' }, { key: 'free', label: 'Free beds' }, { key: 'occupiedBy', label: 'Occupied by' }, { key: 'stage', label: 'Stage', value: (r) => stageByKey(r.stage).label }, { key: 'daysInStage', label: 'Days in stage' }, { key: 'targetMonthly', label: 'Target monthly' }, { key: 'targetPerBed', label: 'Target per bed' }, { key: 'settleMonthly', label: 'Settle floor' }, { key: 'lastOffer', label: 'Offered per bed' }, { key: 'monthlyRent', label: 'Signed' }, { key: 'signedPerBed', label: 'Signed per bed' }, { key: 'vsTargetPerBed', label: 'Vs target per bed' }, { key: 'breach', label: 'Below settle', value: (r) => (r.breach ? 'yes' : '') }, { key: 'expectedTenants', label: 'Expected tenants' }, { key: 'followup', label: 'Follow-up' }, { key: 'leases', label: 'Leases', value: (r) => r.leases.map((l) => l.name).join('; ') }, { key: 'lastNote', label: 'Last note', value: (r) => (r.lastNote ? r.lastNote.text : r.notes || '') }])); })}>Export CSV</Button>
        {data && <span className="muted">{fmtInt(data.total)} units · {fmtInt(data.totalBeds)} beds</span>}
      </div>
      {selection.size > 0 && <div className="bulkbar"><span>{selection.size} selected</span><Select label="Set stage on selected" value="" onChange={(v) => v && applyToSelected('stage', v)} options={[{ value: '', label: '…' }, ...PICKER]} /><Button small onClick={() => setSelection(new Set())}>Clear</Button></div>}
      {error ? <ErrorBox error={error} /> : (
        <DataGrid className="pl" columns={columns} rows={rows} rowKey="key" edits={edits} onEdit={onEdit} results={results} selection={selection} onSelectionChange={setSelection} sort={sortState} onSort={onSort} loading={loading} density={density} rowHeight={{ comfortable: 64, compact: 44 }} isMobile={isMobile} cardRenderer={card}
          expanded={expanded} expandedHeight={360} renderExpanded={(r) => <UnitHistory row={r} sel={sel} onOpenNotes={(x) => setDrawer({ kind: 'notes', row: x })} onOpenLease={(x) => setDrawer({ kind: 'lease', row: x })} />}
          empty={{ title: 'No units match these filters', body: 'Widen the stage or availability filter, or clear the search.' }}
          footer={data && data.total > view.pageSize && <div className="pager"><Button small disabled={view.page === 0} onClick={() => setView({ ...view, page: view.page - 1 })}>‹ Prev</Button><span>{view.page * view.pageSize + 1}–{Math.min(data.total, (view.page + 1) * view.pageSize)} of {fmtInt(data.total)}</span><Button small disabled={(view.page + 1) * view.pageSize >= data.total} onClick={() => setView({ ...view, page: view.page + 1 })}>Next ›</Button></div>} />
      )}
      {(dirtyCount > 0 || msg) && <div className="savebar" role="status"><strong>{dirtyCount} {dirtyCount === 1 ? 'row' : 'rows'} edited</strong><span className="muted small">{msg}{isPreview() ? ' · preview mode: nothing is written' : ''}</span><span className="spacer" /><Toggle label="Autosave" checked={auto} onChange={setAuto} /><Button small onClick={revert} disabled={!dirtyCount}>Revert</Button><Button kind="primary" small disabled={saving || !dirtyCount} onClick={() => save()}>{saving ? 'Saving…' : 'Save now'}</Button></div>}
      {drawer && drawer.kind === 'history' && <HistoryDrawer row={drawer.row} sel={sel} onClose={() => setDrawer(null)} onOpenNotes={(r) => setDrawer({ kind: 'notes', row: r })} onOpenLease={(r) => setDrawer({ kind: 'lease', row: r })} />}
      {drawer && drawer.kind === 'notes' && <NotesDrawer row={{ ...drawer.row, ayId }} sel={sel} today={data ? data.today : bootstrap.session.today} onClose={() => setDrawer(null)} />}
      {drawer && drawer.kind === 'lease' && <LeaseDialog row={drawer.row} sel={sel} onClose={() => setDrawer(null)} />}
    </div>
  );
}
