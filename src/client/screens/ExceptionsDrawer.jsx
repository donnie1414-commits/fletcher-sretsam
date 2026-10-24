import { useMemo, useState } from 'react';
import { useRoute } from '../hooks.js';
import { recordUrl, isPreview, post, invalidate } from '../api.js';
import { Drawer, Disclosure, Button, Pill, Skeleton, ErrorBox, Dot, Select, Table } from '../ui.jsx';
import { fmtInt, fmtMoney, fmtMoney2, fmtDate, toCSV, downloadCSV } from '../format.js';
import { MARKETS, LEASE, LEASE_TYPES, LEASE_STATUSES } from '../../shared/constants.js';

export function useExceptionCount(sel) { const { data } = useRoute('exceptions', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market }); return data ? data.count : null; }

/** §6.6 Exceptions: the blocking exclusions first (the only rows that change the numbers), then the advisory lists, each fixable in place. */
export function ExceptionsDrawer({ open, onClose, sel, bootstrap }) {
  const { data, error, loading } = useRoute('exceptions', { ay: sel.ay, basis: sel.basis, fund: sel.fund, market: sel.market }, open);
  const lists = useRoute('lists', {}, open);
  const ayLabel = `AY ${String(sel.ay).slice(2)}-${String(sel.ay + 1).slice(2)}`;
  return (
    <Drawer open={open} onClose={onClose} title={`Exceptions · ${ayLabel}`} subtitle={data ? `${fmtInt(data.count)} blocking · ${fmtInt(data.advisoryCount || 0)} advisory · ${sel.basis === 'executed' ? 'Fully Executed' : 'Pro-forma'} basis` : ''} width={760}>
      {error ? <ErrorBox error={error} /> : loading || !data ? <Skeleton rows={5} cols={2} /> : (
        <div className="exc">
          <p className="muted small">{data.overlapRule ? 'Overlap rule on: sequential leases are not conflicts.' : 'Legacy rule: any two leases on one scope in one year are a conflict (overlap rule pending sign-off).'}</p>
          <BlockingCard data={data} ayLabel={ayLabel} basis={sel.basis} />
          {data.tenantDoubles.length > 0 && <section className="alert"><h3>⚠ Tenants on more than one lease ({data.tenantDoubles.length})</h3><p className="muted small">One person on two active {ayLabel} leases: both leases count their beds, their rent and their headcount. Clear these first — they move the numbers, not just the list.</p>
            {data.tenantDoubles.map((d) => <div key={d.tenantId} className="alert-row"><a className="link" href={recordUrl('customer', d.tenantId)} target="_blank" rel="noreferrer">Tenant #{d.tenantId}</a> is on {d.leases.map((l) => <span key={l.leaseId}> <a className="link" href={recordUrl('lease', l.leaseId)} target="_blank" rel="noreferrer">{l.leaseName}</a> ({l.property}{l.unit ? ' · ' + l.unit : ''}, {MARKETS.find((m) => m.id === l.market)?.label || l.market}, {fmtMoney(l.monthlyRent)}/mo, {fmtDate(l.start)}–{fmtDate(l.end)})</span>).reduce((a, b) => [a, ' and', b])}. Duplicate rent: {fmtMoney(Math.min(...d.leases.map((l) => l.monthlyRent)))}/mo.</div>)}
          </section>}
          <h3 className="exc-h">Lease exceptions <span className="count">{data.total}</span></h3>
          {data.groups.filter((g) => g.code !== 'TENANT_DOUBLE').map((g) => (
            <Disclosure key={g.code} summary={<span><Dot level={g.severity <= 1 ? 2 : g.severity <= 3 ? 1 : 0} /> {g.label} <span className="count">{g.rows.length}</span>{!g.excludes && <Pill tone="muted">does not exclude</Pill>}</span>} defaultOpen={g.severity <= 1}>
              <p className="muted small">{g.meaning}</p>
              <p className="small"><strong>To fix:</strong> {g.action}</p>
              <div className="toolbar"><Button small onClick={() => downloadCSV(`exceptions-${g.code}.csv`, toCSV(g.rows, [{ key: 'leaseName', label: 'Lease' }, { key: 'property', label: 'Property' }, { key: 'unit', label: 'Unit' }, { key: 'bedroom', label: 'Bedroom' }, { key: 'typeKey', label: 'Type' }, { key: 'statusKey', label: 'Status' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'monthlyRent', label: 'Monthly' }, { key: 'detail', label: 'Detail' }, { key: 'partners', label: 'With', value: (r) => r.partners.join(' ') }]))}>CSV</Button></div>
              <ul className="exc-list">{g.rows.map((r, i) => <ExceptionRow key={r.leaseId + ':' + i} r={r} lists={lists.data} bootstrap={bootstrap} sel={sel} />)}</ul>
            </Disclosure>
          ))}
          {!data.groups.length && <p>No lease exceptions in your markets for this year.</p>}
          <FixSection kind="lease" title="Lease dates & status" note={`Date and status gaps the weekly report depends on. ${ayLabel}, every status.`} rows={data.leaseQuality || []} recordLabel="Lease" linkType="lease" />
          <FixSection kind="tenant" title="Tenant records" note="Tenants linked to this academic year's counted leases (lease Tenants field). People counts use Number of Tenants, so mismatches change headcount." rows={data.tenantQuality || []} recordLabel="Record" linkType={(r) => (r.kind === 'tenant' ? 'customer' : 'lease')} />
          <FixSection kind="records" title="Property & unit records" note="Inventory gaps the report works around; they do not exclude leases." rows={data.records || []} recordLabel="Record" linkType={(r) => (r.kind === 'property' ? 'property' : r.kind === 'unit' ? 'unit' : null)} collapsed />
        </div>
      )}
    </Drawer>
  );
}

function BlockingCard({ data, ayLabel, basis }) {
  const list = data.blocking || [], t = data.blockingTotal || { leases: 0, beds: 0, people: 0, mrev: 0, trev: 0 };
  if (!list.length) return <section className="sec"><div className="sec-head"><div><h3>Nothing is being excluded</h3><p className="muted small">Every active lease in {ayLabel} on the {basis === 'executed' ? 'Fully Executed' : 'Pro-forma'} basis is counted. The sections below are advisory only.</p></div></div></section>;
  return (
    <section className="sec blocking">
      <div className="sec-head"><div><h3>Excluded from the leasing numbers <em className="sec-count">{fmtInt(t.leases)} lease{t.leases === 1 ? '' : 's'} · {fmtInt(t.beds)} beds · {fmtMoney(t.trev)}</em></h3><p className="muted small">The only rows on this tab that change the numbers. Until each is fixed its beds sit as vacant and its rent is missing from every figure. Ranked by what they cost. Open a reason for its leases.</p></div></div>
      <Table cols={[{ label: 'Reason', align: 'l', value: (r) => <strong>{r.label}</strong>, foot: () => 'Total' }, { label: 'Leases', value: (r) => fmtInt(r.leases), foot: (x) => fmtInt(x.leases) }, { label: 'Beds', value: (r) => fmtInt(r.beds), foot: (x) => fmtInt(x.beds) }, { label: 'People', value: (r) => fmtInt(r.people), foot: (x) => fmtInt(x.people) }, { label: 'Monthly Rent', value: (r) => fmtMoney2(r.mrev), foot: (x) => fmtMoney2(x.mrev) }, { label: 'Total Revenue', value: (r) => fmtMoney(r.trev), foot: (x) => fmtMoney(x.trev) }]} rows={list} keyOf={(r) => r.code} foot={t} />
      {list.map((r) => <Disclosure key={r.code} summary={<span>{r.label} <span className="count">{fmtInt(r.leases)} lease{r.leases === 1 ? '' : 's'} · {fmtInt(r.beds)} beds · {fmtMoney(r.trev)}</span></span>}>
        <p className="muted small">{r.meaning} <strong>Fix:</strong> {r.fix}</p>
        <Table cols={[{ label: 'Lease', align: 'l', value: (e) => <a className="link" href={recordUrl('lease', e.id)} target="_blank" rel="noreferrer">{e.name}</a> }, { label: 'Market', align: 'l', value: (e) => e.market || '–' }, { label: 'Property', align: 'l', value: (e) => e.property || '–' }, { label: 'Units/Bedroom', align: 'l', value: (e) => e.linked || '–' }, { label: 'Type', align: 'l', value: (e) => e.type }, { label: 'Beds', value: (e) => fmtInt(e.beds) }, { label: 'People', value: (e) => fmtInt(e.people) }, { label: 'Monthly Rent', value: (e) => fmtMoney2(e.mrev) }, { label: 'Total Revenue', value: (e) => fmtMoney(e.trev) }, { label: 'With', align: 'l', value: (e) => e.partners.map((p) => <a key={p} className="link" href={recordUrl('lease', p)} target="_blank" rel="noreferrer">#{p} </a>) }]} rows={r.rows} />
      </Disclosure>)}
    </section>
  );
}

/** v2 fixSection: issue chips (severity first), search, CSV, one table. */
function FixSection({ kind, title, note, rows, recordLabel, linkType, collapsed = false }) {
  const [issue, setIssue] = useState('');
  const [q, setQ] = useState('');
  const groups = useMemo(() => { const m = new Map(); for (const r of rows) { const g = m.get(r.issue) || { issue: r.issue, count: 0, sev: 0 }; g.count++; g.sev = Math.max(g.sev, r.sev || 0); m.set(r.issue, g); } return [...m.values()].sort((a, b) => b.sev - a.sev || b.count - a.count); }, [rows]);
  const shown = rows.filter((r) => (!issue || r.issue === issue) && (!q || `${r.record} ${r.property} ${r.detail || ''}`.toLowerCase().includes(q.toLowerCase())));
  const linkOf = (r) => (typeof linkType === 'function' ? linkType(r) : linkType);
  const body = rows.length ? <>
    <div className="fix-sum">{groups.map((g) => <button type="button" key={g.issue} className={`fix-chip ${g.sev > 1 ? 'sev' : ''} ${issue === g.issue ? 'on' : ''}`} onClick={() => setIssue(issue === g.issue ? '' : g.issue)}><b>{fmtInt(g.count)}</b> {g.issue}</button>)}</div>
    <div className="toolbar"><span className="muted small">Click an issue to filter the list.</span><span className="spacer" /><input type="search" className="search" placeholder="Search record or property…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} /><Button small onClick={() => downloadCSV(`exceptions-${kind}.csv`, toCSV(shown, [{ key: 'record', label: recordLabel }, { key: 'issue', label: 'Issue' }, { key: 'fix', label: 'Action to fix' }, { key: 'property', label: 'Property' }, { key: 'linked', label: 'Unit' }, { key: 'market', label: 'Market' }, { key: 'detail', label: 'Detail' }, { key: 'handling', label: 'How the report handles it' }]))}>Export CSV</Button></div>
    <Table maxHeight={420} cols={[{ label: recordLabel, align: 'l', value: (r) => (linkOf(r) && r.recordId ? <a className="link" href={recordUrl(linkOf(r), r.recordId)} target="_blank" rel="noreferrer">{r.record}</a> : r.record) }, { label: 'Issue', align: 'l', value: (r) => <span>{r.issue}{r.detail ? <span className="muted small"> · {r.detail}</span> : null}</span> }, { label: 'Action to fix', align: 'l', value: (r) => <span className="small">{r.fix}</span> }, { label: 'Related', align: 'l', value: (r) => (r.related || []).slice(0, 6).map((x) => <a key={x.id} className="link small" href={recordUrl(x.kind === 'tenant' ? 'customer' : x.kind, x.id)} target="_blank" rel="noreferrer">{x.name} </a>) }, { label: 'Property', align: 'l', value: (r) => r.property || '–' }, { label: 'Unit', align: 'l', value: (r) => r.linked || '–' }, { label: 'Market', align: 'l', value: (r) => r.market || '–' }, { label: 'Monthly', value: (r) => (r.mrev == null ? '–' : fmtMoney2(r.mrev)) }]} rows={shown} keyOf={(r, i) => `${r.kind}:${r.recordId}:${r.code}:${i}`} />
  </> : <p className="muted small">Nothing to fix: no {title.toLowerCase()} issues for this selection.</p>;
  return <Disclosure defaultOpen={!collapsed && rows.length > 0} summary={<span>{title} <span className="count">{fmtInt(rows.length)} to fix</span></span>}><p className="muted small">{note}</p>{body}</Disclosure>;
}

/** One exception with fix-in-place: relink, change type, correct dates or academic year, set status, inactivate — each posted through the write module with before → after. */
function ExceptionRow({ r, lists, bootstrap, sel }) {
  const [fix, setFix] = useState(null); // 'status' | 'type' | 'link' | 'dates' | 'ay' | 'inactivate'
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const prop = lists && lists.properties ? lists.properties.find((p) => p.id === String(r.propertyId)) : null;
  const linkOptions = prop ? prop.units.flatMap((u) => [{ value: u.id, label: `${u.name} (unit, ${u.beds} beds)` }, ...u.bedrooms.map((b) => ({ value: b.id, label: `  ${u.name} › ${b.name} (bedroom)` }))]) : [];
  const apply = async () => {
    const fields = {};
    if (fix === 'status') fields[LEASE.STATUS] = Number(vals.status);
    if (fix === 'type') fields['custrecord_serp_lease_type_test'] = Number(vals.type);
    if (fix === 'link') fields[LEASE.UNIT] = vals.link ? Number(vals.link) : null;
    if (fix === 'dates') { if (vals.start) fields[LEASE.START] = vals.start; if (vals.end) fields[LEASE.END] = vals.end; }
    if (fix === 'ay') fields[LEASE.AY] = Number(vals.ay);
    if (fix === 'inactivate') fields.isinactive = true;
    if (!Object.keys(fields).length) return;
    setBusy(true);
    const res = await post('write', { changes: [{ changeId: `fix:${r.leaseId}:${fix}:${Date.now()}`, recordType: LEASE.TYPE, recordId: r.leaseId, version: r.version || undefined, fields }] });
    const x = (res.results || [])[0];
    setBusy(false); setOut(x || { ok: false, message: 'No response' });
    if (x && x.ok) { invalidate('exceptions'); invalidate('summary'); invalidate('portfolio'); invalidate('pipeline'); invalidate('today'); }
  };
  const ids = bootstrap ? bootstrap.ids : { leaseType: {}, leaseStatus: {} };
  const typeOpts = Object.entries(ids.leaseType || {}).map(([id, k]) => ({ value: id, label: LEASE_TYPES[k] ? LEASE_TYPES[k].label : k }));
  const statusOpts = Object.entries(ids.leaseStatus || {}).map(([id, k]) => ({ value: id, label: LEASE_STATUSES[k] ? LEASE_STATUSES[k].label : k }));
  const before = { status: r.statusKey === 'NONE' ? 'no status' : r.statusKey, type: r.typeKey || 'blank', link: r.unit || r.bedroom || (r.linkId ? `#${r.linkId}` : 'none'), dates: `${fmtDate(r.start)} – ${fmtDate(r.end)}`, ay: r.ay };
  const after = { status: (statusOpts.find((o) => o.value === vals.status) || {}).label, type: (typeOpts.find((o) => o.value === vals.type) || {}).label, link: (linkOptions.find((o) => o.value === vals.link) || {}).label, dates: `${fmtDate(vals.start || r.start)} – ${fmtDate(vals.end || r.end)}`, ay: vals.ay && bootstrap ? (bootstrap.academicYears.find((a) => a.id === vals.ay) || {}).label : '' }[fix];
  return (
    <li>
      <div><a className="link" href={recordUrl('lease', r.leaseId)} target="_blank" rel="noreferrer">{r.leaseName}</a> <span className="muted small">{r.typeKey || 'no type'} · {r.statusKey === 'NONE' ? 'no status' : r.statusKey} · {fmtDate(r.start)}–{fmtDate(r.end)} · {fmtMoney(r.monthlyRent)}/mo</span></div>
      <div className="muted small">{r.property && <a className="link" href={recordUrl('property', r.propertyId)} target="_blank" rel="noreferrer">{r.property}</a>}{r.unit && <> · <a className="link" href={recordUrl('unit', r.unitId)} target="_blank" rel="noreferrer">{r.unit}</a></>}{r.bedroom && <> · {r.bedroom}</>}{r.detail && <> · {r.detail}</>}{r.partners.length > 0 && <> · with {r.partners.map((p) => <a key={p} className="link" href={recordUrl('lease', p)} target="_blank" rel="noreferrer">#{p}</a>).reduce((a, b) => [a, ', ', b])}</>}{r.overlapDays != null && <> · overlaps {r.overlapDays} days</>}</div>
      <div className="fixbar small">
        {['status', 'type', 'link', 'dates', 'ay', 'inactivate'].map((k) => <button type="button" key={k} className={`linkish ${fix === k ? 'on' : ''}`} onClick={() => { setFix(fix === k ? null : k); setOut(null); }}>{{ status: 'Set status', type: 'Change type', link: 'Relink', dates: 'Correct dates', ay: 'Change AY', inactivate: 'Inactivate' }[k]}</button>)}
      </div>
      {fix && <div className="fixform small">
        {fix === 'status' && <Select label="Status" value={vals.status || ''} onChange={(v) => setVals({ ...vals, status: v })} options={[{ value: '', label: '…' }, ...statusOpts]} />}
        {fix === 'type' && <Select label="Lease type" value={vals.type || ''} onChange={(v) => setVals({ ...vals, type: v })} options={[{ value: '', label: '…' }, ...typeOpts]} />}
        {fix === 'link' && <Select label="Units/Bedrooms" value={vals.link || ''} onChange={(v) => setVals({ ...vals, link: v })} options={[{ value: '', label: prop ? '(no link — whole property)' : 'property not in your lists' }, ...linkOptions]} />}
        {fix === 'dates' && <><label className="field"><span className="field-label">Start</span><input type="date" value={vals.start || r.start || ''} onChange={(e) => setVals({ ...vals, start: e.target.value })} /></label><label className="field"><span className="field-label">End</span><input type="date" value={vals.end || r.end || ''} onChange={(e) => setVals({ ...vals, end: e.target.value })} /></label></>}
        {fix === 'ay' && <Select label="Academic year" value={vals.ay || ''} onChange={(v) => setVals({ ...vals, ay: v })} options={[{ value: '', label: '…' }, ...(bootstrap ? bootstrap.academicYears.map((a) => ({ value: a.id, label: a.label })) : [])]} />}
        {fix === 'inactivate' && <span className="warn-text">Inactivates the lease record (never deletes). Its beds read vacant from the next run.</span>}
        <span className="muted">{before[fix === 'inactivate' ? 'status' : fix]} → <strong>{after || '…'}</strong>{fix === 'ay' && ' (the Tenants field is captured and restored around the change)'}</span>
        <Button small kind="primary" disabled={busy || isPreview()} onClick={apply} title={isPreview() ? 'Preview mode: nothing is written' : ''}>{busy ? 'Applying…' : 'Apply & re-run'}</Button>
        {isPreview() && <span className="muted">Preview: nothing is written.</span>}
        {out && <span className={out.ok ? 'okbox' : 'errorbox'}>{out.ok ? 'Written. Re-running the rules…' : `${out.code}: ${out.message}`}</span>}
      </div>}
    </li>
  );
}
