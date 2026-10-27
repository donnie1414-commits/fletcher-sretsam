import { useState } from 'react';
import { useRoute } from '../../hooks.js';
import { post, invalidate, isPreview, recordUrl } from '../../api.js';
import { Modal, Button, Select, Toggle } from '../../ui.jsx';
import { CUSTOMER, TOUR, LEAD } from '../../../shared/constants.js';
import { TourFields, buildTourFields, nextSlot, useOrganizers } from './TourDialog.jsx';

/** The first unit of interest, for prefilling the tour. */
function firstUnit(f, properties) {
  for (const p of properties) for (const u of p.units) if (f.unitIds.includes(u.id)) return { propertyId: p.id, unitId: u.id };
  return { propertyId: f.propertyIds[0] || '', unitId: '' };
}
/** Properties of interest (several) and, under each chosen property, its units. */
function PickProperties({ f, setF, t, setT, properties, q, setQ }) {
  const chosen = properties.filter((p) => f.propertyIds.includes(p.id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? properties.filter((p) => !f.propertyIds.includes(p.id) && (p.name.toLowerCase().includes(needle) || p.market.includes(needle))).slice(0, 12) : [];
  const toggleUnit = (id) => { const unitIds = f.unitIds.includes(id) ? f.unitIds.filter((x) => x !== id) : [...f.unitIds, id]; setF({ ...f, unitIds }); if (f.withTour && !t.unitId) { const fu = firstUnit({ ...f, unitIds }, properties); setT({ ...t, propertyId: fu.propertyId, unitId: fu.unitId }); } };
  const add = (p) => { setF({ ...f, propertyIds: [...f.propertyIds, p.id] }); setQ(''); if (f.withTour && !t.propertyId) setT({ ...t, propertyId: p.id }); };
  const remove = (p) => setF({ ...f, propertyIds: f.propertyIds.filter((x) => x !== p.id), unitIds: f.unitIds.filter((u) => !p.units.some((x) => x.id === u)) });
  return (
    <div className="field grow pick-props">
      <span className="field-label">Properties of interest {chosen.length ? <span className="muted">· {chosen.length}</span> : null}</span>
      {chosen.map((p) => <div key={p.id} className="pick-prop">
        <div className="pick-prop-head"><strong>{p.name}</strong> <span className="muted small">{p.market}</span> <button type="button" className="linkish small" onClick={() => remove(p)}>remove</button></div>
        {p.units.length ? <div className="pick-units">{p.units.map((u) => <label key={u.id} className="toggle"><input type="checkbox" checked={f.unitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} /><span>{u.name} <span className="muted">· {u.beds} bed{u.beds === 1 ? '' : 's'}</span></span></label>)}</div> : <span className="muted small">no unit records at this property</span>}
      </div>)}
      <div className="search-pick"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={chosen.length ? 'Add another property…' : 'Type to find a property…'} />
        {matches.length > 0 && <ul className="hits">{matches.map((p) => <li key={p.id}><button type="button" onClick={() => add(p)}>{p.name} <span className="muted small">{p.market} · {p.units.length} unit{p.units.length === 1 ? '' : 's'}</span></button></li>)}</ul>}
      </div>
      <span className="muted small">Tick the units they want to see; the tour scheduler starts from the first one.</span>
    </div>
  );
}

/**
 * Add a lead from the hub (A-22): the same record the public Lead Form creates — a person at Tenant-New — with the school,
 * what they asked for, the source and the owning agent. Optionally schedules the first tour in the same save.
 */
export function LeadDialog({ sel, bootstrap, onClose, onDone, onTourFor }) {
  const lists = useRoute('lists', {});
  const organizers = useOrganizers(bootstrap);
  const me = String(bootstrap.session.userId);
  const ayDefault = (bootstrap.academicYears.find((a) => a.year === Number(sel.ay)) || {}).id || '';
  const [f, setF] = useState({ first: '', last: '', email: '', phone: '', schoolId: '', propertyIds: [], unitIds: [], ayId: ayDefault, groupSize: '', desired: '', sourceId: '', notes: '', agentId: me, withTour: false });
  const [propQ, setPropQ] = useState('');
  const [t, setT] = useState({ propertyId: '', unitId: '', date: bootstrap.session.today, start: nextSlot(), minutes: 30, organizerId: me, notes: '', ayId: ayDefault });
  const [busy, setBusy] = useState(false); const [out, setOut] = useState(null);
  const properties = (lists.data && lists.data.properties) || [];
  const schools = (lists.data && lists.data.schools) || []; const sources = (lists.data && lists.data.hearUs) || [];
  const name = `${f.first} ${f.last}`.trim();
  const valid = (name || f.email) && (!f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) && (!f.withTour || (t.date && t.organizerId));
  const save = async () => {
    setBusy(true); setOut(null);
    const fields = { firstname: f.first.trim(), lastname: f.last.trim(), email: f.email.trim(), phone: f.phone.trim(), custentity_serp_schools: f.schoolId ? Number(f.schoolId) : '', custentity_desired_location: f.desired.trim(), custentity_serp_group_size: f.groupSize === '' ? '' : Number(f.groupSize), custentity_serp_howdid_you_hear_about_us: f.sourceId ? Number(f.sourceId) : '', custentity_serp_notes: f.notes.trim(), salesrep: f.agentId ? Number(f.agentId) : '' };
    if (f.propertyIds.length) fields[CUSTOMER.PROPERTY] = f.propertyIds.map(Number);
    if (f.unitIds.length) fields[LEAD.UNITS] = f.unitIds.map(Number);
    if (f.ayId) fields[CUSTOMER.AY] = [Number(f.ayId)];
    for (const k of Object.keys(fields)) if (fields[k] === '' || fields[k] == null) delete fields[k];
    const stamp = Date.now();
    const changes = [{ changeId: `lead:new:${stamp}`, recordType: CUSTOMER.TYPE, fields }];
    if (f.withTour) changes.push({ changeId: `tour:lead:${stamp}`, recordType: TOUR.TYPE, fields: buildTourFields({ ...t, propertyId: t.propertyId || f.propertyIds[0] || '', ayId: f.ayId }, properties, { customerName: name || f.email, customerId: '$prev' }) });
    const res = await post('write', { changes });
    setBusy(false); const results = res.results || []; setOut({ lead: results[0] || { ok: false, code: 'ERROR', message: 'no result' }, tour: results[1] || null });
    if (results[0] && results[0].ok) { for (const k of ['leads', 'tenants', 'today', 'tours']) invalidate(k); onDone && onDone(results[0]); }
  };
  const done = out && out.lead.ok;
  return (
    <Modal open onClose={onClose} title="Add a lead" width={760}
      foot={<div className="toolbar"><span className="muted small">{isPreview() ? 'Preview: nothing is written.' : `Creates the customer record at Tenant-New, the way the Lead Form does, owned by the agent you pick.`}</span><span className="spacer" /><Button small onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>{!done && <Button kind="primary" small disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : f.withTour ? 'Add lead and schedule tour' : 'Add lead'}</Button>}</div>}>
      <div className="lease-form">
        <div className="form-row">
          <label className="field"><span className="field-label">First name</span><input value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} autoFocus /></label>
          <label className="field"><span className="field-label">Last name</span><input value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></label>
          <label className="field"><span className="field-label">Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field"><span className="field-label">Phone</span><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        </div>
        <div className="form-row">
          <Select label="School" value={f.schoolId} onChange={(v) => setF({ ...f, schoolId: v })} options={[{ value: '', label: '—' }, ...schools.map((s) => ({ value: s.id, label: s.name }))]} />
          <Select label="Academic year" value={f.ayId} onChange={(v) => setF({ ...f, ayId: v })} options={[{ value: '', label: '—' }, ...bootstrap.academicYears.map((a) => ({ value: a.id, label: a.label }))]} />
          <label className="field"><span className="field-label">Group size</span><input type="number" min="1" step="1" value={f.groupSize} onChange={(e) => setF({ ...f, groupSize: e.target.value })} /></label>
        </div>
        <PickProperties f={f} setF={setF} setT={setT} t={t} properties={properties} q={propQ} setQ={setPropQ} />
        <div className="form-row">
          <label className="field grow"><span className="field-label">Asked for (house, unit, area)</span><input value={f.desired} onChange={(e) => setF({ ...f, desired: e.target.value })} placeholder="e.g. 411 Webster, 4 beds near campus" /></label>
          <Select label="How did they hear about us" value={f.sourceId} onChange={(v) => setF({ ...f, sourceId: v })} options={[{ value: '', label: '—' }, ...sources.map((s) => ({ value: s.id, label: s.name }))]} />
          <Select label="Owning agent" value={f.agentId} onChange={(v) => setF({ ...f, agentId: v })} options={organizers.map((o) => ({ value: o.id, label: o.name }))} />
        </div>
        <div className="form-row"><label className="field grow"><span className="field-label">Notes</span><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label></div>
        <div className="form-row"><Toggle label="Schedule a tour now" checked={f.withTour} onChange={(v) => { setF({ ...f, withTour: v }); if (v && !t.propertyId) { const first = firstUnit(f, properties); setT({ ...t, propertyId: first.propertyId || f.propertyIds[0] || '', unitId: first.unitId || '' }); } }} /></div>
        {f.withTour && <TourFields f={t} setF={setT} properties={properties} organizers={organizers} compact />}
        {out && (out.lead.ok
          ? <div className="okbox small">Lead added at Lead · New{out.lead.recordId && !isPreview() ? <span> · <a className="link" href={recordUrl('customer', out.lead.recordId)} target="_blank" rel="noreferrer">open the record</a></span> : ''}. {out.tour ? (out.tour.ok ? <span>Tour scheduled{out.tour.leadStatus ? ' · lead moved to Tour Scheduled' : ''}.</span> : <span className="warn-text">The tour was not scheduled: {out.tour.code}: {out.tour.message}</span>) : null} {out.lead.dropped && out.lead.dropped.includes('salesrep') && <span className="warn-text">The owning agent was not saved: that employee is not flagged as a Sales Rep on their employee record.</span>} {out.lead.dropped && out.lead.dropped.includes(LEAD.UNITS) && <span className="warn-text">Units of interest were not saved: the field {LEAD.UNITS} is not created yet (SETUP-CHECKLIST).</span>}</div>
          : out.lead.code === 'DUPLICATE'
            ? <div className="errorbox small">{out.lead.message}. <a className="link" href={recordUrl('customer', out.lead.existingId)} target="_blank" rel="noreferrer">Open it</a>{onTourFor && <span> · <button type="button" className="linkish" onClick={() => onTourFor({ id: out.lead.existingId, name: name || f.email, properties: [] })}>schedule a tour for the existing record</button></span>}</div>
            : <div className={`${out.lead.code === 'PREVIEW' ? 'okbox' : 'errorbox'} small`}>{out.lead.code === 'PREVIEW' ? out.lead.message : `${out.lead.code}: ${out.lead.message}`}</div>)}
        <p className="muted small">Created as a Lead at <strong>Lead · New</strong>. Scheduling a tour moves it to <strong>Tour Scheduled</strong>, and marking the tour Completed to <strong>Tour Completed</strong>. It becomes a tenant when it is attached to a lease.</p>
      </div>
    </Modal>
  );
}
