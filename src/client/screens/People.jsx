import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../hooks.js';
import { recordUrl, isPreview, post } from '../api.js';
import { DataGrid } from '../components/DataGrid/DataGrid.jsx';
import { Segmented, Select, Button, Pill, ErrorBox, Empty } from '../ui.jsx';
import { fmtInt, fmtDate, toCSV, downloadCSV } from '../format.js';
import { SavedViews } from './SavedViews.jsx';

export function People({ sel, seg, setSeg, density, isMobile }) {
  return (
    <div className="screen">
      <div className="subnav"><Segmented ariaLabel="People segment" value={seg} onChange={setSeg} options={[{ value: 'tenants', label: 'Tenants' }, { value: 'leads', label: 'Leads' }]} /></div>
      {seg === 'tenants' ? <Tenants sel={sel} density={density} isMobile={isMobile} /> : <Empty title="Leads is waiting on the discovery review" body="Leads are the same customer records as tenants, entering as Tenant-New. The §5.5.0 write-up (docs/LEAD-DISCOVERY.md) asks two model questions; the segment is designed once they are answered. The Tenants grid already shows the new inquiries that lack a Property." />}
    </div>
  );
}
export function Tenants({ sel, density, isMobile }) {
  const [view, setView] = useState({ view: 'needs-attention', status: '', q: sel.q || '', sort: 'name', dir: 'asc', page: 0, pageSize: 100 });
  useEffect(() => { setView((v) => ({ ...v, q: sel.q || '', page: 0 })); }, [sel.q]);
  const { data, error, loading } = useRoute('tenants', { ...view, market: sel.market });
  const [selection, setSelection] = useState(new Set());
  const [edits, setEdits] = useState({});
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
    <div>
      <div className="toolbar wrap">
        <Segmented ariaLabel="Tenant view" value={view.view} onChange={(v) => setView({ ...view, view: v, page: 0 })} options={[{ value: 'needs-attention', label: 'Needs attention' }, { value: 'all', label: 'All' }]} />
        <Select label="Status" value={view.status} onChange={(v) => setView({ ...view, status: v, page: 0 })} options={[{ value: '', label: 'Any' }, ...statuses.map((s) => ({ value: String(s.id), label: s.name }))]} />
        <Select label="Sort" value={view.sort} onChange={(v) => setView({ ...view, sort: v })} options={[{ value: 'name', label: 'Name' }, { value: 'created', label: 'Created' }, { value: 'status', label: 'Status' }]} />
        <SavedViews workspace="tenants" state={view} onApply={(s) => setView({ ...view, ...s, page: 0 })} />
        <Button small onClick={() => downloadCSV('tenants.csv', toCSV(rows, columns))}>CSV</Button>
        {data && <span className="muted">{fmtInt(data.total)} tenants</span>}
      </div>
      {selection.size > 0 && <div className="bulkbar"><span>{selection.size} selected</span><span className="muted">Bulk assign Property / Academic Year appends to the existing values (never replaces).</span><Button small disabled title={isPreview() ? 'Preview mode' : ''}>Assign property…</Button><Button small disabled title={isPreview() ? 'Preview mode' : ''}>Assign academic year…</Button><Button small onClick={() => setSelection(new Set())}>Clear</Button></div>}
      {error ? <ErrorBox error={error} /> : (
        <DataGrid columns={columns} rows={rows} rowKey="id" selection={selection} onSelectionChange={setSelection} loading={loading} density={density} isMobile={isMobile}
          cardRenderer={(r) => <div className="card-body"><div className="card-top"><strong>{r.name}</strong>{r.ready.ready ? <Pill tone="done">ready</Pill> : <Pill tone="warn">blocked</Pill>}</div><div className="card-row muted">{r.status} · {r.properties.map((p) => p.name).join(', ') || 'no property'} · {r.academicYears.map((a) => a.label.replace('AY ', '')).join(', ') || 'no AY'}</div>{!r.ready.ready && <div className="card-row warn-text">{r.ready.reasons.join('; ')}</div>}{r.desiredLocation && <div className="card-row muted">asked for {r.desiredLocation}</div>}</div>}
          empty={{ title: view.view === 'needs-attention' ? 'Nobody is blocked' : 'No tenants match', body: view.view === 'needs-attention' ? 'Every tenant in your markets has a Property and an Academic Year.' : 'Try another status or clear the search.' }}
          footer={data && data.total > view.pageSize && <div className="pager"><Button small disabled={view.page === 0} onClick={() => setView({ ...view, page: view.page - 1 })}>‹ Prev</Button><span>{view.page * view.pageSize + 1}–{Math.min(data.total, (view.page + 1) * view.pageSize)} of {fmtInt(data.total)}</span><Button small disabled={(view.page + 1) * view.pageSize >= data.total} onClick={() => setView({ ...view, page: view.page + 1 })}>Next ›</Button></div>} />
      )}
    </div>
  );
}
