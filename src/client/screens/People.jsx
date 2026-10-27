import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../hooks.js';
import { recordUrl, isPreview, post, invalidate } from '../api.js';
import { DataGrid } from '../components/DataGrid/DataGrid.jsx';
import { Segmented, Select, Button, Pill, ErrorBox, Empty, Modal } from '../ui.jsx';
import { fmtInt, fmtDate, toCSV, downloadCSV } from '../format.js';
import { CUSTOMER } from '../../shared/constants.js';
import { SavedViews } from './SavedViews.jsx';
import { TourDialog, TourLine, fmtTime } from './people/TourDialog.jsx';
import { LeadDialog } from './people/LeadDialog.jsx';

export function People({ sel, seg, setSeg, density, isMobile, bootstrap }) {
  return (
    <div className="screen fill">
      <div className="subnav"><Segmented ariaLabel="People segment" value={seg} onChange={setSeg} options={[{ value: 'tenants', label: 'Tenants' }, { value: 'leads', label: 'Leads' }]} /></div>
      {seg === 'tenants' ? <Tenants sel={sel} density={density} isMobile={isMobile} bootstrap={bootstrap} /> : <Leads sel={sel} density={density} isMobile={isMobile} bootstrap={bootstrap} />}
    </div>
  );
}
export function Tenants({ sel, density, isMobile, bootstrap }) {
  const [view, setView] = useState({ view: 'needs-attention', status: '', q: sel.q || '', sort: 'name', dir: 'asc', page: 0, pageSize: 100 });
  useEffect(() => { setView((v) => ({ ...v, q: sel.q || '', page: 0 })); }, [sel.q]);
  const { data, error, loading } = useRoute('tenants', { ...view, market: sel.market });
  const [selection, setSelection] = useState(new Set());
  const [assign, setAssign] = useState(null); // 'property' | 'ay'
  const rows = data ? data.rows : [];
  const columns = useMemo(() => [
    { key: 'name', label: 'Tenant', width: 200, render: (v, r) => <a className="link" href={recordUrl('customer', r.id)} target="_blank" rel="noreferrer">{v}</a> },
    { key: 'contact', label: 'Contact', width: 220, value: (r) => [r.email, r.phone].filter(Boolean).join(' · '), render: (v, r) => <span className="muted small">{v}{r.duplicate && <Pill tone="warn">dup?</Pill>}</span> },
    { key: 'status', label: 'Status', width: 150 },
    { key: 'property', label: 'Property', width: 220, value: (r) => r.properties.map((p) => p.name).join(', '), render: (v) => v || <span className="warn-text">none</span> },
    { key: 'ay', label: 'Academic year', width: 170, value: (r) => r.academicYears.map((a) => a.label.replace('AY ', '')).join(', '), render: (v) => v || <span className="warn-text">none</span> },
    { key: 'leases', label: 'Leases', width: 120, value: (r) => r.leases.length, render: (v, r) => v ? r.leases.map((id) => <a key={id} className="link" href={recordUrl('lease', id)} target="_blank" rel="noreferrer">#{id}</a>).reduce((a, b) => [a, ' ', b]) : <span className="muted">—</span> },
    { key: 'ready', label: 'Ready to attach', width: 260, value: (r) => (r.ready.ready ? 'yes' : r.ready.reasons.join('; ')), render: (v, r) => r.ready.ready ? <Pill tone="done">ready</Pill> : <span className="warn-text">{r.ready.reasons.join('; ')}</span> },
    { key: 'desiredLocation', label: 'Asked for', width: 200, render: (v) => <span className="muted">{v}</span> },
    { key: 'created', label: 'Created', type: 'date', width: 100 },
  ], []);
  const statuses = data?.statuses || [];
  return (
    <div className="fill-col">
      <div className="toolbar wrap">
        <Segmented ariaLabel="Tenant view" value={view.view} onChange={(v) => setView({ ...view, view: v, page: 0 })} options={[{ value: 'needs-attention', label: 'Needs attention' }, { value: 'all', label: 'All' }]} />
        <Select label="Status" value={view.status} onChange={(v) => setView({ ...view, status: v, page: 0 })} options={[{ value: '', label: 'Any' }, ...statuses.map((s) => ({ value: String(s.id), label: s.name }))]} />
        <Select label="Sort" value={view.sort} onChange={(v) => setView({ ...view, sort: v })} options={[{ value: 'name', label: 'Name' }, { value: 'created', label: 'Created' }, { value: 'status', label: 'Status' }]} />
        <SavedViews workspace="tenants" state={view} onApply={(s) => setView({ ...view, ...s, page: 0 })} />
        <Button small onClick={() => downloadCSV('tenants.csv', toCSV(rows, columns))}>CSV</Button>
        {data && <span className="muted">{fmtInt(data.total)} tenants</span>}
      </div>
      {selection.size > 0 && <div className="bulkbar"><span>{selection.size} selected</span><span className="muted small">Property and academic year append to the existing values; status replaces it.</span><Button small onClick={() => setAssign('property')}>Assign property…</Button><Button small onClick={() => setAssign('ay')}>Assign academic year…</Button><Button small onClick={() => setAssign('status')}>Set status…</Button><Button small onClick={() => setSelection(new Set())}>Clear</Button></div>}
      {error ? <ErrorBox error={error} /> : (
        <DataGrid className="fill" height={null} columns={columns} rows={rows} rowKey="id" selection={selection} onSelectionChange={setSelection} loading={loading} density={density} isMobile={isMobile}
          cardRenderer={(r) => <div className="card-body"><div className="card-top"><strong>{r.name}</strong>{r.ready.ready ? <Pill tone="done">ready</Pill> : <Pill tone="warn">blocked</Pill>}</div><div className="card-row muted">{r.status} · {r.properties.map((p) => p.name).join(', ') || 'no property'} · {r.academicYears.map((a) => a.label.replace('AY ', '')).join(', ') || 'no AY'}</div>{!r.ready.ready && <div className="card-row warn-text">{r.ready.reasons.join('; ')}</div>}{r.desiredLocation && <div className="card-row muted">asked for {r.desiredLocation}</div>}</div>}
          empty={{ title: view.view === 'needs-attention' ? 'Nobody is blocked' : 'No tenants match', body: view.view === 'needs-attention' ? 'Every tenant in your markets has a Property and an Academic Year.' : 'Try another status or clear the search.' }}
          footer={data && data.total > view.pageSize && <div className="pager"><Button small disabled={view.page === 0} onClick={() => setView({ ...view, page: view.page - 1 })}>‹ Prev</Button><span>{view.page * view.pageSize + 1}–{Math.min(data.total, (view.page + 1) * view.pageSize)} of {fmtInt(data.total)}</span><Button small disabled={(view.page + 1) * view.pageSize >= data.total} onClick={() => setView({ ...view, page: view.page + 1 })}>Next ›</Button></div>} />
      )}
      {assign && <AssignDialog kind={assign} rows={rows.filter((r) => selection.has(r.id))} bootstrap={bootstrap} statuses={statuses} onClose={() => setAssign(null)} onDone={() => { setAssign(null); setSelection(new Set()); invalidate('tenants'); invalidate('today'); }} />}
    </div>
  );
}
/** Bulk Property / Academic Year / Status: property and AY append to the tenant's existing multi-select (§6.5), status replaces; one write per tenant, per-row results. */
function AssignDialog({ kind, rows, bootstrap, statuses = [], onClose, onDone }) {
  const lists = useRoute('lists', {}, kind === 'property');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const options = kind === 'property' ? (lists.data ? lists.data.properties.map((p) => ({ value: p.id, label: `${p.name} (${p.market})` })) : []) : kind === 'status' ? statuses.map((st) => ({ value: String(st.id), label: st.name })) : bootstrap.academicYears.map((a) => ({ value: a.id, label: a.label }));
  const field = kind === 'property' ? CUSTOMER.PROPERTY : kind === 'status' ? 'entitystatus' : CUSTOMER.AY;
  const apply = async () => {
    setBusy(true);
    const changes = rows.map((r) => { if (kind === 'status') return { changeId: `assign:${r.id}:status:${Date.now()}`, recordType: CUSTOMER.TYPE, recordId: r.id, version: r.version || undefined, fields: { entitystatus: Number(value) } }; const have = (kind === 'property' ? r.properties : r.academicYears).map((x) => x.id); return { changeId: `assign:${r.id}:${kind}:${Date.now()}`, recordType: CUSTOMER.TYPE, recordId: r.id, version: r.version || undefined, fields: { [field]: [...new Set([...have, value])].map(Number) } }; });
    const res = await post('write', { changes });
    setBusy(false); setOut(res);
    if ((res.results || []).some((x) => x.ok)) setTimeout(onDone, 800);
  };
  return (
    <Modal open onClose={onClose} title={`${kind === 'property' ? 'Assign a property to' : kind === 'status' ? 'Set the status of' : 'Assign an academic year to'} ${rows.length} tenant${rows.length === 1 ? '' : 's'}`} width={560}
      foot={<div className="toolbar"><span className="muted small">{isPreview() ? 'Preview: nothing is written.' : kind === 'status' ? 'Replaces each tenant’s status.' : 'Appends to each tenant’s existing values; properties must be in your markets.'}</span><span className="spacer" /><Button small onClick={onClose}>Cancel</Button><Button kind="primary" small disabled={!value || busy} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</Button></div>}>
      <Select label={kind === 'property' ? 'Property' : kind === 'status' ? 'Status' : 'Academic year'} value={value} onChange={setValue} options={[{ value: '', label: '…' }, ...options]} />
      <ul className="small muted" style={{ maxHeight: 200, overflow: 'auto' }}>{rows.map((r) => <li key={r.id}>{r.name} <span>— currently {kind === 'property' ? (r.properties.map((p) => p.name).join(', ') || 'none') : kind === 'status' ? (r.status || 'none') : (r.academicYears.map((a) => a.label).join(', ') || 'none')}</span></li>)}</ul>
      {out && <div className="small">{(out.results || []).map((x) => <div key={x.changeId} className={x.ok ? 'okbox' : 'errorbox'}>{x.ok ? 'Written' : `${x.code}: ${x.message}`}</div>)}</div>}
    </Modal>
  );
}

/**
 * §6.5 Leads: the inbound inquiries (Tenant-New, not yet on a lease) in my markets. Triage per row: open, schedule a tour,
 * assign property / academic year in bulk. "Add lead" creates the record the way the Lead Form does.
 */
export function Leads({ sel, density, isMobile, bootstrap }) {
  const [view, setView] = useState({ view: 'new', q: sel.q || '', sort: 'created', page: 0, pageSize: 100 });
  useEffect(() => { setView((v) => ({ ...v, q: sel.q || '', page: 0 })); }, [sel.q]);
  const { data, error, loading } = useRoute('leads', { ...view, market: sel.market });
  const [selection, setSelection] = useState(new Set());
  const [assign, setAssign] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'lead' } | { kind: 'tour', lead, tour }
  const rows = data ? data.rows : [];
  const refresh = () => { invalidate('leads'); invalidate('today'); invalidate('tours'); };
  const columns = useMemo(() => [
    { key: 'name', label: 'Lead', width: 210, render: (v, r) => <span className="lead-cell"><a className="link" href={recordUrl('customer', r.id)} target="_blank" rel="noreferrer">{v}</a>{r.isNew && <Pill tone="info">new</Pill>}{r.duplicate && <Pill tone="warn" title="Another active customer shares this email, or NetSuite flagged a duplicate">dup?</Pill>}</span> },
    { key: 'contact', label: 'Contact', width: 220, value: (r) => [r.email, r.phone].filter(Boolean).join(' · '), render: (v) => <span className="muted small">{v}</span> },
    { key: 'status', label: 'Status', width: 140, render: (v, r) => <Pill tone={r.statusId === 23 ? 'pending' : r.statusId === 22 ? 'done' : r.statusId === 18 ? 'active' : r.statusId === 21 || r.statusId === 24 ? 'muted' : 'info'}>{v}</Pill> },
    { key: 'school', label: 'School', width: 170, render: (v) => v || <span className="muted">—</span> },
    { key: 'desiredLocation', label: 'Asked for', width: 200, render: (v) => v ? <span>{v}</span> : <span className="muted">—</span> },
    { key: 'units', label: 'Units of interest', width: 200, value: (r) => (r.unitsOfInterest || []).map((u) => u.name).join(', '), render: (v) => v || <span className="muted">—</span> },
    { key: 'property', label: 'Property', width: 200, value: (r) => r.properties.map((p) => p.name).join(', '), render: (v) => v || <span className="warn-text">none</span> },
    { key: 'ay', label: 'Academic year', width: 130, value: (r) => r.academicYears.map((a) => a.label.replace('AY ', '')).join(', '), render: (v) => v || <span className="warn-text">none</span> },
    { key: 'tour', label: 'Next tour', width: 250, value: (r) => (r.nextTour ? `${r.nextTour.date} ${r.nextTour.start || ''}` : r.lastTour ? `last ${r.lastTour.date}` : ''), render: (v, r) => <span className="tours-cell">{r.nextTour ? <span><strong>{fmtDate(r.nextTour.date)}</strong> {fmtTime(r.nextTour.start)} <span className="muted small">{[r.nextTour.property, r.nextTour.unit].filter(Boolean).join(' · ')}{r.nextTour.organizer ? ` · ${r.nextTour.organizer}` : ''}</span> <button type="button" className="linkish small" onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'tour', lead: r, tour: r.nextTour }); }}>update</button></span> : <span className="muted small">{r.lastTour ? `last tour ${fmtDate(r.lastTour.date)}${r.lastTour.outcome && r.lastTour.outcome !== 'SCHEDULED' ? ` · ${r.lastTour.outcome.toLowerCase().replace('_', '-')}` : ''}` : 'no tour yet'}</span>}{data && data.toursAvailable !== false && <Button small onClick={(e) => { e.stopPropagation(); setDialog({ kind: 'tour', lead: r }); }}>Tour…</Button>}</span> },
    { key: 'source', label: 'Source', width: 140, render: (v) => v || <span className="muted">—</span> },
    { key: 'agent', label: 'Agent', width: 140, render: (v) => v || <span className="muted">—</span> },
    { key: 'groupSize', label: 'Group', type: 'number', width: 70 },
    { key: 'created', label: 'Created', type: 'date', width: 100 },
  ], [data && data.toursAvailable]);
  const counts = (data && data.counts) || {};
  const statuses = (data && data.statuses) || [];
  return (
    <div className="fill-col">
      <div className="toolbar wrap">
        <Segmented ariaLabel="Lead view" value={view.view} onChange={(v) => setView({ ...view, view: v, page: 0 })} options={[{ value: 'new', label: 'New', count: counts.new }, { value: 'no-tour', label: 'No tour', count: counts['no-tour'] }, { value: 'no-property', label: 'No property', count: counts['no-property'] }, { value: 'all', label: 'All', count: counts.all }]} />
        <Select label="Sort" value={view.sort} onChange={(v) => setView({ ...view, sort: v })} options={[{ value: 'created', label: 'Newest first' }, { value: 'name', label: 'Name' }, { value: 'tour', label: 'Next tour' }, { value: 'school', label: 'School' }]} />
        <Button kind="primary" small onClick={() => setDialog({ kind: 'lead' })}>+ Add lead</Button>
        {data && data.toursAvailable !== false && <Button small onClick={() => setDialog({ kind: 'tour' })}>Schedule tour…</Button>}
        {!isPreview() && data && data.calendarUrl && <a className="btn btn-sm" href={data.calendarUrl} target="_blank" rel="noreferrer">My calendar</a>}
        <Button small onClick={() => downloadCSV('leads.csv', toCSV(rows, columns))}>CSV</Button>
        {data && <span className="muted">{fmtInt(data.total)} lead{data.total === 1 ? '' : 's'} <span className="small">· Lead-stage records plus tenants marked Inquiring</span></span>}
        {data && data.toursAvailable === false && <span className="warn-text small">Tours are off: calendar events are not readable by your role.</span>}
      </div>
      {selection.size > 0 && <div className="bulkbar"><span>{selection.size} selected</span><span className="muted small">Property and academic year append to the existing values.</span><Button small onClick={() => setAssign('property')}>Assign property…</Button><Button small onClick={() => setAssign('ay')}>Assign academic year…</Button><Button small onClick={() => setSelection(new Set())}>Clear</Button></div>}
      {error ? <ErrorBox error={error} /> : (
        <DataGrid className="fill" height={null} columns={columns} rows={rows} rowKey="id" selection={selection} onSelectionChange={setSelection} loading={loading} density={density} isMobile={isMobile} rowHeight={{ comfortable: 56, compact: 44 }}
          cardRenderer={(r) => <div className="card-body"><div className="card-top"><strong>{r.name}</strong><Pill tone="muted">{r.status}</Pill>{r.isNew && <Pill tone="info">new</Pill>}{r.duplicate && <Pill tone="warn">dup?</Pill>}</div><div className="card-row muted">{[r.school, r.desiredLocation ? `asked for ${r.desiredLocation}` : null, r.properties.map((p) => p.name).join(', ') || 'no property'].filter(Boolean).join(' · ')}</div><div className="card-row muted small">{[r.email, r.phone].filter(Boolean).join(' · ')}</div><div className="card-row">{r.nextTour ? <span>Tour <strong>{fmtDate(r.nextTour.date)}</strong> {fmtTime(r.nextTour.start)}</span> : <span className="muted">no tour yet</span>} <Button small onClick={() => setDialog({ kind: 'tour', lead: r, tour: r.nextTour || undefined })}>{r.nextTour ? 'Update tour' : 'Tour…'}</Button></div></div>}
          empty={{ title: view.view === 'new' ? 'No new inquiries' : view.view === 'no-tour' ? 'Every lead has a tour' : view.view === 'no-property' ? 'Every lead has a property' : 'No leads', body: view.view === 'new' ? `Nothing arrived in the last 14 days in your markets. Switch to All, or add a lead.` : 'Try another view or clear the search.' }}
          footer={data && data.total > view.pageSize && <div className="pager"><Button small disabled={view.page === 0} onClick={() => setView({ ...view, page: view.page - 1 })}>‹ Prev</Button><span>{view.page * view.pageSize + 1}–{Math.min(data.total, (view.page + 1) * view.pageSize)} of {fmtInt(data.total)}</span><Button small disabled={(view.page + 1) * view.pageSize >= data.total} onClick={() => setView({ ...view, page: view.page + 1 })}>Next ›</Button></div>} />
      )}
      {assign && <AssignDialog kind={assign} rows={rows.filter((r) => selection.has(r.id))} bootstrap={bootstrap} statuses={statuses} onClose={() => setAssign(null)} onDone={() => { setAssign(null); setSelection(new Set()); refresh(); }} />}
      {dialog && dialog.kind === 'lead' && <LeadDialog sel={sel} bootstrap={bootstrap} onClose={() => setDialog(null)} onDone={refresh} onTourFor={(lead) => setDialog({ kind: 'tour', lead })} />}
      {dialog && dialog.kind === 'tour' && <TourDialog lead={dialog.lead} tour={dialog.tour} sel={sel} bootstrap={bootstrap} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}
