import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../../hooks.js';
import { api, post, invalidate, isPreview, recordUrl } from '../../api.js';
import { Modal, Button, Select, Skeleton, ErrorBox, Pill, cx } from '../../ui.jsx';
import { fmtMoney, fmtDate } from '../../format.js';
import { CHANGE_SCENARIOS, CHANGE_CONDITIONS, routeConditions, canApply } from '../../../shared/rules/leaseChangeMeta.js';

const PATH_TEXT = {
  EDIT: { tone: 'muted', label: 'Not sent', note: 'Nothing has gone to the tenants: the lease is changed directly.' },
  REVISE: { tone: 'warn', label: 'Sent, unsigned', note: 'The lease is revised in place, the stage moves to Lease Revisions, and the documents must be voided and sent again.' },
  AMEND: { tone: 'ok', label: 'Fully executed', note: 'The signed lease is never overwritten. An amendment is filed for approval and applied once the addendum is signed.' },
};
const STEP_TEXT = { updateLease: 'Update lease', createLease: 'Create lease', tenantScope: 'Give tenants the property / AY', tenantStatus: 'Tenant status', stage: 'Leasing stage', manual: 'To do' };
const MECH_TEXT = { REVISE: 'Revise in place', SUPERSEDE: 'Supersede (end + new linked lease)', TERMINATE: 'Terminate early', CANCEL: 'Cancel (inactivate)', TRANSFER: 'Transfer to another house', ASSIGN: 'Assignment on the same lease' };

/**
 * "Change lease" (docs/LEASE-CHANGES-BUILD.md): tick everything that applies, fill in what each needs, preview exactly what
 * will be written, then submit. The ticks route to one of the nine workflows (routeConditions) and the lease's state
 * decides the path; the server re-routes, re-plans and re-checks everything on submit.
 */
export function ChangeLeaseDialog({ leaseId, title, onClose }) {
  const { data, error, loading } = useRoute('leasechange', { lease: leaseId }, !!leaseId);
  const [conds, setConds] = useState([]);
  const [moving, setMoving] = useState(false); // a leaver is moving to another lease
  const [inp, setInp] = useState({ tenantsAdded: [], tenantsRemoved: [] });
  const [target, setTarget] = useState({ propertyId: '', unitId: '' });
  const [otherLeaseId, setOther] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [added, setAdded] = useState([]); // [{id,name}] picked through search
  useEffect(() => { setPreview(null); }, [conds, inp, target, otherLeaseId, moving, added]);
  if (!leaseId) return null;
  const on = (k) => conds.includes(k);
  const toggle = (k) => setConds((c) => (c.includes(k) ? c.filter((x) => x !== k) : k === 'END' ? ['END'] : [...c.filter((x) => x !== 'END'), k]));
  const other = on('LEAVE') && moving && otherLeaseId ? otherLeaseId : null;
  const route = !conds.length ? null : on('LEAVE') && moving && !on('MOVE') && !otherLeaseId ? { scenario: null, errors: ['pick the lease they are moving to'] } : routeConditions(conds, { otherLeaseId: other });
  const sc = route && route.scenario ? CHANGE_SCENARIOS.find((s) => s.key === route.scenario) : null;
  const scenario = route ? route.scenario : null;
  const set = (k, v) => setInp((s) => ({ ...s, [k]: v }));
  // only what the ticked boxes ask for travels: an unticked box's leftovers never reach the plan
  const input = () => ({ effective: inp.effective, reason: inp.reason, ...(on('LEAVE') ? { tenantsRemoved: inp.tenantsRemoved } : {}), ...(on('JOIN') ? { tenantsAdded: added.map((a) => a.id) } : {}), ...(on('RENT') ? { newRent: inp.newRent, otherNewRent: inp.otherNewRent } : {}), ...(on('DATES') ? { newStart: inp.newStart, newEnd: inp.newEnd } : {}), ...(on('PROVISIONS') ? { provisions: inp.provisions } : {}), ...(on('END') ? { fee: inp.fee } : {}) });
  const body = (action) => ({ action, leaseId, conditions: conds, input: input(), otherLeaseId: other, targetUnitId: on('MOVE') ? target.unitId || null : null, targetPropertyId: on('MOVE') && !target.unitId && target.propertyId ? target.propertyId : null });

  const doPreview = async () => {
    setBusy(true);
    try { setPreview(await post('leasechange', body('plan'))); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post('leasechange', { ...body('submit'), changeId: `${leaseId}:${scenario}:${Date.now().toString(36)}` });
      setDone(r); if (r.ok) { invalidate('pipeline'); invalidate('leasechange'); invalidate('unithistory'); }
    } finally { setBusy(false); }
  };
  const applyNow = async (id) => { setBusy(true); try { const r = await post('leasechange', { action: 'apply', amendmentId: id, leaseId }); setDone(r); if (r.ok) { invalidate('pipeline'); invalidate('leasechange'); } } finally { setBusy(false); } };

  const plan = preview && (preview.plan || null);
  const errs = preview ? (preview.error ? [preview.error] : plan ? plan.errors : []) : [];
  const foot = <div className="toolbar">
    <span className="muted small">{isPreview() ? 'Preview: nothing is written.' : plan && plan.ok ? (plan.path === 'AMEND' ? 'Files an amendment for approval; the lease is unchanged until it is applied.' : 'Changes the lease now and logs the change.') : 'Preview first: it shows every record that will change.'}</span>
    <span className="spacer" /><Button small onClick={onClose}>{done && done.ok ? 'Close' : 'Cancel'}</Button>
    {!done && <Button small disabled={busy || !conds.length || (route && route.errors.length > 0)} onClick={doPreview}>{busy && !plan ? 'Checking…' : 'Preview'}</Button>}
    {!done && <Button kind="primary" small disabled={busy || !plan || !plan.ok} onClick={submit}>{busy && plan ? 'Saving…' : plan && plan.path === 'AMEND' ? 'File amendment' : 'Make the change'}</Button>}
  </div>;

  return (
    <Modal open onClose={onClose} title={<span>Change lease · {title || (data && data.lease.name) || leaseId}</span>} foot={foot} width={820}>
      {error ? <ErrorBox error={error} /> : loading || !data ? <Skeleton rows={6} cols={2} /> : (
        <div className="lc">
          <div className="lc-head">
            <a className="link" href={recordUrl('lease', data.lease.id)} target="_blank" rel="noreferrer">{data.lease.name}</a>
            <Pill tone={PATH_TEXT[data.path] ? PATH_TEXT[data.path].tone : 'muted'}>{PATH_TEXT[data.path] ? PATH_TEXT[data.path].label : data.state}</Pill>
            <span className="muted small">{fmtDate(data.lease.start)} – {fmtDate(data.lease.end)} · {fmtMoney(data.lease.monthly)}/mo · {data.lease.tenants.length} tenant{data.lease.tenants.length === 1 ? '' : 's'}{data.lease.version ? ` · v${data.lease.version}` : ''}{data.lease.supersedes ? ' · amends an earlier lease' : ''}</span>
          </div>
          {data.state === 'CLOSED' ? <p className="muted">This lease is inactive. Nothing can be changed on it.</p> : <>
            <p className="muted small">{PATH_TEXT[data.path] && PATH_TEXT[data.path].note}</p>
            {data.path === 'AMEND' && !data.ready.amendments && <div className="banner warn small">The Lease Amendment record is not set up in NetSuite yet, so signed leases cannot be changed from here. See Setup.</div>}
            <fieldset className="lc-types"><legend>What is changing? Tick all that apply</legend>
              {CHANGE_CONDITIONS.map((c) => <label key={c.key} className={cx('lc-type', on(c.key) && 'on')}><input type="checkbox" checked={on(c.key)} onChange={() => toggle(c.key)} /><span>{c.label}<span className="muted small"> · {c.hint}</span></span></label>)}
            </fieldset>
            {route && <div className={cx('lc-route small', route.errors.length && 'bad-text')}>{route.errors.length ? route.errors.join('; ') : <span>Routes to <b>{sc ? sc.label : scenario}</b>{sc ? <span className="muted"> · {sc.doc}</span> : null}</span>}</div>}
            {conds.length > 0 && <div className="lc-inputs form-grid">
              <label>Effective date<input type="date" value={inp.effective || ''} onChange={(e) => set('effective', e.target.value)} /><span className="muted small">{data.path === 'AMEND' ? 'Required: the first day of the new arrangement; anything that ends, ends the day before.' : 'Optional before signing; dates provisions.'}</span></label>
              {on('LEAVE') && <div className="lc-field"><span>Leaving the lease</span>{data.lease.tenants.map((t) => <label key={t.id} className="check"><input type="checkbox" checked={(inp.tenantsRemoved || []).includes(t.id)} onChange={(e) => set('tenantsRemoved', e.target.checked ? [...(inp.tenantsRemoved || []), t.id] : (inp.tenantsRemoved || []).filter((x) => x !== t.id))} /> {t.name}</label>)}
                {!on('MOVE') && <label className="check"><input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} /> They are moving to another of our leases</label>}</div>}
              {on('LEAVE') && moving && !on('MOVE') && <label>Moving to (lease)<Select ariaLabel="Other lease" value={otherLeaseId} onChange={setOther} options={[{ value: '', label: 'Pick a lease…' }, ...data.siblings.filter((l) => l.state !== 'CLOSED').map((l) => ({ value: l.id, label: `${l.name}${l.propertyName ? ` · ${l.propertyName}` : ''}` }))]} /></label>}
              {on('JOIN') && <TenantPicker picked={added} onChange={setAdded} exclude={data.lease.tenants.map((t) => t.id)} />}
              {on('RENT') && <label>New monthly rent<input type="number" min="0" step="1" value={inp.newRent ?? ''} placeholder={String(data.lease.monthly || '')} onChange={(e) => set('newRent', e.target.value === '' ? null : Number(e.target.value))} /><span className="muted small">For the whole lease (now {fmtMoney(data.lease.monthly)}).</span></label>}
              {on('RENT') && other && <label>New rent on the lease they join<input type="number" min="0" step="1" value={inp.otherNewRent ?? ''} onChange={(e) => set('otherNewRent', e.target.value === '' ? null : Number(e.target.value))} /></label>}
              {on('DATES') && <label>New start<input type="date" value={inp.newStart || ''} onChange={(e) => set('newStart', e.target.value)} /></label>}
              {on('DATES') && <label>New end<input type="date" value={inp.newEnd || ''} onChange={(e) => set('newEnd', e.target.value)} /></label>}
              {on('END') && <label>Termination fee<input type="number" min="0" step="1" value={inp.fee ?? ''} onChange={(e) => set('fee', e.target.value === '' ? null : Number(e.target.value))} /></label>}
              {on('MOVE') && <><label>Moving to (house)<Select ariaLabel="Target house" value={target.propertyId} onChange={(v) => setTarget({ propertyId: v, unitId: '' })} options={[{ value: '', label: 'Pick a house…' }, ...data.properties.map((p) => ({ value: p.id, label: p.name }))]} /></label>
                {target.propertyId && <label>Unit<Select ariaLabel="Target unit" value={target.unitId} onChange={(v) => setTarget({ ...target, unitId: v })} options={[{ value: '', label: 'Whole house' }, ...((data.properties.find((p) => p.id === target.propertyId) || { units: [] }).units.map((u) => ({ value: u.id, label: u.name })))]} /></label>}</>}
              {on('PROVISIONS') && <label className="wide">Provisions<textarea rows="2" value={inp.provisions || ''} onChange={(e) => set('provisions', e.target.value)} placeholder="e.g. per-person utility cap $75; pet addendum" /></label>}
              <label className="wide">Reason<textarea rows="2" value={inp.reason || ''} onChange={(e) => set('reason', e.target.value)} placeholder="Why, and who asked for it" /></label>
            </div>}
            {preview && <div className="lc-plan">
              {errs.length > 0 && <div className="errorbox" role="alert">{errs.map((e, i) => <div key={i}>{e}</div>)}</div>}
              {plan && plan.ok && <>
                <div className="lc-plan-head"><strong>{MECH_TEXT[plan.mechanism] || plan.mechanism}</strong>{plan.needsApproval ? <Pill tone="warn">needs approval + signed addendum</Pill> : <Pill tone="muted">no approval</Pill>}</div>
                <ol className="lc-steps">{plan.steps.map((s, i) => <li key={i}><b>{STEP_TEXT[s.op] || s.op}</b> {s.op === 'manual' ? s.text : stepDetail(s, data)}<span className="muted small"> — {s.why}</span></li>)}</ol>
                {plan.warnings.map((w, i) => <div key={i} className="muted small">⚠ {w}</div>)}
              </>}
            </div>}
            {done && <div className={cx('lc-done', done.ok ? 'ok' : 'bad')} role="status">
              {done.ok && done.preview ? <span><b>Preview only, nothing was written.</b> In NetSuite this would {done.applied ? 'change the lease now and log the change as Applied' : 'file a Lease Amendment at Pending approval; the lease stays as it is until the addendum is signed and the amendment is applied'}.</span> : done.ok ? (done.applied ? <span>Done. The lease was changed{done.amendmentId ? ' and the change logged' : ''}.</span> : done.already ? <span>Already applied.</span> : done.resultLeaseId ? <span>Applied. New lease <a className="link" href={recordUrl('lease', done.resultLeaseId)} target="_blank" rel="noreferrer">#{done.resultLeaseId}</a>.</span> : <span>Amendment filed for approval{done.amendmentId ? ` (#${done.amendmentId})` : ''}. The approval workflow takes it from here.</span>) : <span>Not saved: {done.error || (done.plan && done.plan.errors.join('; ')) || 'unknown error'}</span>}
              {(done.todo || []).map((t, i) => <div key={i}><b>To do:</b> {t}</div>)}
              {(done.warnings || []).map((w, i) => <div key={`w${i}`} className="muted small">⚠ {w}</div>)}
            </div>}
          </>}
          {data.amendments.length > 0 && <div className="lc-history"><h4>Changes on this lease</h4>
            <table className="tbl small"><thead><tr><th>#</th><th>Change</th><th>How</th><th>Effective</th><th>Status</th><th>Requested by</th><th /></tr></thead>
              <tbody>{data.amendments.map((a) => <tr key={a.id}><td>{a.id}</td><td>{(CHANGE_SCENARIOS.find((s) => s.key === a.scenario) || {}).label || a.scenario}</td><td>{a.kind}</td><td>{fmtDate(a.effective)}</td><td>{a.status}</td><td>{a.requestedBy}</td><td>{(canApply(a.statusKey, { applyOnApproval: data.applyOnApproval }) || a.statusKey === 'FAILED') ? <Button small disabled={busy} onClick={() => applyNow(a.id)}>Apply</Button> : a.resultLeaseId ? <a className="link" href={recordUrl('lease', a.resultLeaseId)} target="_blank" rel="noreferrer">new lease</a> : null}</td></tr>)}</tbody></table>
          </div>}
        </div>
      )}
    </Modal>
  );
}
function stepDetail(s, data) {
  const nm = (id) => (data.lease.tenants.find((t) => t.id === id) || {}).name || `#${id}`;
  if (s.op === 'updateLease' || s.op === 'createLease') { const f = s.fields; const bits = []; if (f.inactive) bits.push('inactivate'); if (f.start) bits.push(`start ${fmtDate(f.start)}`); if (f.end) bits.push(`end ${fmtDate(f.end)}`); if (f.monthly != null) bits.push(`${fmtMoney(f.monthly)}/mo`); if (f.total != null) bits.push(`total ${fmtMoney(f.total)}`); if (f.tenants) bits.push(`${f.tenants.length} tenants`); if (f.endReason) bits.push(`reason ${f.endReason.toLowerCase()}`); if (f.supersedes) bits.push('linked to the old lease'); if (f.groupType) bits.push(`group ${f.groupType.toLowerCase()}`); return `${s.op === 'createLease' ? (f.name || '') : `#${s.leaseId}`}: ${bits.join(', ')}`; }
  if (s.op === 'tenantStatus') return `${s.tenants.map(nm).join(', ')} → ${s.status.toLowerCase()}`;
  if (s.op === 'tenantScope') return `${s.tenants.length} tenant${s.tenants.length === 1 ? '' : 's'}`;
  if (s.op === 'stage') return s.stage === 'LEASE_REVISIONS' ? 'Lease Revisions' : s.stage;
  return '';
}
/** Search tenants by name or email and tick the ones joining. */
function TenantPicker({ picked, onChange, exclude }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return undefined; } let alive = true; setBusy(true); const t = setTimeout(() => { api('tenants', { view: 'all', q: q.trim(), pageSize: 20 }).then((d) => alive && setHits((d.rows || []).filter((r) => !exclude.includes(r.id)))).catch(() => alive && setHits([])).finally(() => alive && setBusy(false)); }, 250); return () => { alive = false; clearTimeout(t); }; }, [q]); // eslint-disable-line
  const ids = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  return <div className="lc-field wide"><span>Joining the lease</span>
    {picked.map((p) => <label key={p.id} className="check"><input type="checkbox" checked onChange={() => onChange(picked.filter((x) => x.id !== p.id))} /> {p.name}</label>)}
    <input type="search" placeholder="Search tenants by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
    {busy && <span className="muted small">Searching…</span>}
    {hits.filter((h) => !ids.has(h.id)).slice(0, 8).map((h) => <button type="button" key={h.id} className="linkish small" onClick={() => { onChange([...picked, { id: h.id, name: h.name }]); setQ(''); }}>+ {h.name}{h.email ? ` · ${h.email}` : ''}</button>)}
    <span className="muted small">A tenant must exist in NetSuite first (add them as a lead or tenant). They are given this lease's property and AY automatically.</span>
  </div>;
}
