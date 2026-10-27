import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../../hooks.js';
import { api, post, invalidate, isPreview, recordUrl } from '../../api.js';
import { Modal, Button, Select, Pill } from '../../ui.jsx';
import { fmtDate } from '../../format.js';
import { TOUR, TOUR_OUTCOMES, CALENDAR_URL } from '../../../shared/constants.js';

const pad = (n) => String(n).padStart(2, '0');
/** The next half-hour from now, as "HH:MM". */
export function nextSlot(d = new Date()) { let m = Math.ceil((d.getMinutes() + 1) / 30) * 30; let h = d.getHours(); if (m >= 60) { m = 0; h = (h + 1) % 24; } return `${pad(h)}:${pad(m)}`; }
export function addMin(hm, n) { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); const t = (h * 60 + m + n) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; }
export function fmtTime(hm) { if (!hm) return 'all day'; const [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; return `${h % 12 || 12}:${pad(m)} ${ap}`; }
export const DURATIONS = [{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '1 hour' }, { value: '90', label: '1½ hours' }];

/** The Event fields for a tour, from the dialog state and the property list. Exported so the lead dialog can chain a tour after the lead. */
export function buildTourFields(f, properties, { customerName = '', customerId = null } = {}) {
  const prop = properties.find((p) => p.id === f.propertyId) || null;
  const unit = prop ? prop.units.find((u) => u.id === f.unitId) || null : null;
  const where = [prop && prop.name, unit && unit.name].filter(Boolean).join(' · ');
  const fields = {
    title: `${TOUR.TITLE_PREFIX} · ${customerName || 'walk-in'}${where ? ' · ' + where : ''}`.slice(0, 199),
    startdate: f.date, starttime: f.start || '', endtime: f.start ? addMin(f.start, Number(f.minutes) || TOUR.DEFAULT_MINUTES) : '',
    organizer: f.organizerId ? Number(f.organizerId) : '', location: where, message: f.notes || '',
    [TOUR.UNIT]: f.unitId ? Number(f.unitId) : '', [TOUR.AY]: f.ayId ? Number(f.ayId) : '',
  };
  if (customerId !== undefined) fields.company = customerId == null || customerId === '' ? '' : (customerId === '$prev' ? '$prev' : Number(customerId));
  return fields;
}
/** Where / when / who-shows-it. Shared by the tour dialog and the "schedule a tour now" block of the lead dialog. */
export function TourFields({ f, setF, properties, organizers, compact = false }) {
  const prop = properties.find((p) => p.id === f.propertyId) || null;
  const units = prop ? prop.units : [];
  return (
    <>
      <div className="form-row">
        <Select label="Property" value={f.propertyId || ''} onChange={(v) => setF({ ...f, propertyId: v, unitId: '' })} options={[{ value: '', label: 'Choose a property…' }, ...properties.map((p) => ({ value: p.id, label: `${p.name} (${p.market})` }))]} />
        <Select label="Unit" value={f.unitId || ''} onChange={(v) => setF({ ...f, unitId: v })} options={[{ value: '', label: prop ? 'Whole property' : '—' }, ...units.map((u) => ({ value: u.id, label: `${u.name} · ${u.beds} bed${u.beds === 1 ? '' : 's'}` }))]} />
      </div>
      <div className="form-row">
        <label className="field"><span className="field-label">Date</span><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field"><span className="field-label">Start</span><input type="time" step="900" value={f.start || ''} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <Select label="Length" value={String(f.minutes || 30)} onChange={(v) => setF({ ...f, minutes: Number(v) })} options={DURATIONS} />
        <Select label="Shown by" value={f.organizerId || ''} onChange={(v) => setF({ ...f, organizerId: v })} options={organizers.map((o) => ({ value: o.id, label: o.name }))} />
      </div>
      {!compact && <div className="form-row"><label className="field grow"><span className="field-label">Notes for the calendar entry</span><textarea rows={2} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Meeting point, what to bring, who else is coming…" /></label></div>}
    </>
  );
}
export function useOrganizers(bootstrap) {
  const team = useRoute('team', {});
  const me = String(bootstrap.session.userId);
  return useMemo(() => { const list = (team.data && team.data.team) || []; const mine = { id: me, name: `${bootstrap.session.name || 'Me'} (me)` }; return [mine, ...list.filter((t) => String(t.id) !== me)]; }, [team.data, me, bootstrap.session.name]);
}
/**
 * Schedule or update a tour (§5.6). A tour is a NetSuite Event organised by the agent, attached to the lead or tenant
 * (company) and to the unit and academic year when those fields exist; it appears on the agent's NetSuite calendar.
 */
export function TourDialog({ lead, unit, tour, sel, bootstrap, onClose, onDone }) {
  const lists = useRoute('lists', {});
  const organizers = useOrganizers(bootstrap);
  const me = String(bootstrap.session.userId);
  const ayDefault = (bootstrap.academicYears.find((a) => a.year === Number(sel.ay)) || {}).id || '';
  const [f, setF] = useState(() => ({
    customerId: tour ? tour.customerId : lead ? lead.id : '', customerName: tour ? (tour.customer || '') : lead ? lead.name : '',
    propertyId: tour ? (tour.propertyId || '') : unit ? unit.propertyId : (lead && lead.properties && lead.properties[0] ? lead.properties[0].id : ''),
    unitId: tour ? (tour.unitId || '') : unit ? (unit.unitId || '') : '',
    date: tour ? tour.date : bootstrap.session.today, start: tour ? (tour.start || '') : nextSlot(), minutes: 30,
    organizerId: tour ? (tour.organizerId || me) : me, notes: tour ? (tour.notes || '') : '', outcome: tour ? (tour.outcome || 'SCHEDULED') : 'SCHEDULED', ayId: tour && tour.ayId ? tour.ayId : ayDefault,
  }));
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return undefined; } let alive = true; const t = setTimeout(() => api('tenants', { view: 'all', q: q.trim(), pageSize: 25 }).then((d) => alive && setHits(d.rows || [])).catch(() => alive && setHits([])), 250); return () => { alive = false; clearTimeout(t); }; }, [q]);
  const [busy, setBusy] = useState(false); const [out, setOut] = useState(null);
  const properties = (lists.data && lists.data.properties) || [];
  const save = async () => {
    setBusy(true); setOut(null);
    const fields = buildTourFields(f, properties, { customerName: f.customerName, customerId: f.customerId || '' });
    if (tour) { fields[TOUR.OUTCOME] = f.outcome; if (f.outcome === 'CANCELLED') fields.status = TOUR.STATUS.CANCELLED; }
    const res = await post('write', { changes: [{ changeId: `tour:${tour ? tour.id : 'new'}:${Date.now()}`, recordType: TOUR.TYPE, recordId: tour ? tour.id : undefined, version: tour ? tour.version : undefined, fields }] });
    setBusy(false); const r = (res.results || [])[0] || { ok: false, code: 'ERROR', message: 'no result' }; setOut(r);
    if (r.ok) { for (const k of ['tours', 'today', 'leads', 'pipeline', 'tenants']) invalidate(k); onDone && onDone(r); }
  };
  const valid = !!f.date && !!f.organizerId;
  return (
    <Modal open onClose={onClose} title={tour ? <span>Tour · {tour.customer || 'walk-in'} <span className="muted small">{fmtDate(tour.date)} {fmtTime(tour.start)}</span></span> : 'Schedule a tour'} width={720}
      foot={<div className="toolbar"><span className="muted small">{isPreview() ? 'Preview: nothing is written.' : 'Creates a NetSuite Event on the agent’s calendar.'}</span><span className="spacer" /><Button small onClick={onClose}>{out && out.ok ? 'Close' : 'Cancel'}</Button>{!(out && out.ok) && <Button kind="primary" small disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : tour ? 'Save changes' : 'Schedule tour'}</Button>}</div>}>
      <div className="lease-form">
        <div className="form-row">
          <div className="field grow"><span className="field-label">Who is touring</span>
            {f.customerId ? <div className="picked"><strong>{f.customerName || `customer #${f.customerId}`}</strong> <a className="link small" href={recordUrl('customer', f.customerId)} target="_blank" rel="noreferrer">open</a> {!tour && <button type="button" className="linkish small" onClick={() => setF({ ...f, customerId: '', customerName: '' })}>change</button>}</div>
              : <div className="search-pick"><input type="search" placeholder="Search leads and tenants by name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                {hits.length > 0 && <ul className="hits">{hits.map((h) => <li key={h.id}><button type="button" onClick={() => { setF({ ...f, customerId: h.id, customerName: h.name, propertyId: f.propertyId || (h.properties[0] ? h.properties[0].id : '') }); setQ(''); setHits([]); }}>{h.name} <span className="muted small">{h.status}{h.email ? ` · ${h.email}` : ''}{h.properties.length ? ` · ${h.properties.map((p) => p.name).join(', ')}` : ''}</span></button></li>)}</ul>}
                {q.trim().length >= 2 && !hits.length && <p className="muted small">No match. Leave blank for a walk-in, or add the lead first from People › Leads.</p>}
              </div>}
          </div>
          <Select label="Academic year" value={f.ayId || ''} onChange={(v) => setF({ ...f, ayId: v })} options={[{ value: '', label: '—' }, ...bootstrap.academicYears.map((a) => ({ value: a.id, label: a.label }))]} />
        </div>
        <TourFields f={f} setF={setF} properties={properties} organizers={organizers} />
        {tour && <div className="form-row"><Select label="Outcome" value={f.outcome} onChange={(v) => setF({ ...f, outcome: v })} options={TOUR_OUTCOMES.map((o) => ({ value: o.key, label: o.label }))} /><span className="muted small">Cancelled also cancels the calendar event. Leased is for a tour that turned into a signed lease.</span></div>}
        {out && (out.ok ? <div className="okbox small">{tour ? 'Tour updated.' : 'Tour scheduled.'} {out.dropped && out.dropped.length ? <span className="warn-text">The {out.dropped.map((d) => d.replace('custevent_ad_tour_', '')).join(', ')} field{out.dropped.length === 1 ? ' is' : 's are'} not created yet, so the tour was saved without {out.dropped.length === 1 ? 'it' : 'them'} (property and unit are in the location). See SETUP-CHECKLIST.</span> : null} {!isPreview() && <span> <a className="link" href={recordUrl('event', out.recordId)} target="_blank" rel="noreferrer">Open the event</a> · <a className="link" href={CALENDAR_URL} target="_blank" rel="noreferrer">Open my calendar</a></span>}</div>
          : <div className={`${out.code === 'PREVIEW' ? 'okbox' : 'errorbox'} small`}>{out.code === 'PREVIEW' ? out.message : `${out.code}: ${out.message}`}</div>)}
      </div>
    </Modal>
  );
}
/** One tour as a line: when · who · where · by whom, with an Update button. */
export function TourLine({ t, onEdit, showDate = true }) {
  return <span className="tour-line">{showDate && <strong>{fmtDate(t.date)}</strong>} <span>{fmtTime(t.start)}</span> {t.customerId ? <a className="link" href={recordUrl('customer', t.customerId)} target="_blank" rel="noreferrer">{t.customer || `#${t.customerId}`}</a> : <span className="muted">walk-in</span>} <span className="muted">{[t.property, t.unit].filter(Boolean).join(' · ') || t.location || ''}</span> {t.organizer && <span className="muted small">· {t.organizer}</span>} {t.outcome && t.outcome !== 'SCHEDULED' && <Pill tone={t.outcome === 'LEASED' ? 'done' : t.outcome === 'CANCELLED' || t.outcome === 'NO_SHOW' ? 'warn' : 'muted'}>{(TOUR_OUTCOMES.find((o) => o.key === t.outcome) || {}).label || t.outcome}</Pill>}{onEdit && <button type="button" className="linkish small" onClick={() => onEdit(t)}>update</button>}</span>;
}
