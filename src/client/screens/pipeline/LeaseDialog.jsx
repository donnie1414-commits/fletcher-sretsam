import { useEffect, useMemo, useState } from 'react';
import { useRoute } from '../../hooks.js';
import { post, invalidate, isPreview } from '../../api.js';
import { Modal, Button, Select, Skeleton, ErrorBox, Toggle, Pill } from '../../ui.jsx';
import { recordUrl } from '../../api.js';
import { fmtInt, fmtMoney, fmtMoney2, fmtDate } from '../../format.js';
import { prefill, buildLeaseChanges, leaseScope, overlappingLeases, nextFreeStart } from '../../../shared/rules/leaseDialog.js';
import { addDays, ayForDate } from '../../../shared/rules/dates.js';
import { getBootstrap } from '../../api.js';
import { LEASE, GROUP_TYPES, LEASE_TYPES, UAS } from '../../../shared/constants.js';

/**
 * §6.4 Create lease record. Prefill rules live in shared/rules/leaseDialog.js: the market calendar sets the dates,
 * targets set rent per bed, term follows the dates, a bedroom lease defaults to the free bedrooms. Anything the user
 * touches is never auto-overwritten. The lease is written with NO status (§5.3) so capturing terms never moves pre-leasing.
 */
export function LeaseDialog({ row, sel, onClose, onCreated }) {
  const { data, error, loading } = useRoute('leasedialog', { ay: sel.ay, basis: sel.basis, unit: row && row.unitId }, !!(row && row.unitId));
  const [state, setState] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [resolutions, setResolutions] = useState({}); // leaseId → { action: 'end', end } | { action: 'archive' }
  useEffect(() => { if (!data) return; const t = row.leaseTerms || {}; const base = { type: t.type || 'UNIT', twoYear: !!t.twoYear, groupType: t.groupType || 'NEW', bedroomIds: t.bedroomIds || [], water: !!t.water, gas: !!t.gas, provisions: t.provisions || '', notes: t.notes || '', expectedNames: t.expectedNames || '' }; const tch = new Set(Object.keys(t).filter((k) => ['start', 'end', 'rentPerBed', 'expectedNames', 'bedroomIds'].includes(k))); if (t.start) base.start = t.start; if (t.end) base.end = t.end; if (t.rentPerBed != null) base.rentPerBed = t.rentPerBed; setTouched(tch); let st = prefill(base, data, tch); if (!tch.has('start') && st.start && st.end && (data.existing || []).length) { const free = nextFreeStart(st.start, st.end, data.existing, leaseScope(st, data)); if (free !== st.start) { tch.add('start'); st = prefill({ ...st, start: free }, data, tch); } } setTouched(tch); setState(st); }, [data]); // eslint-disable-line
  const set = (k, v, isTouch = true) => { const tch = new Set(touched); if (isTouch) tch.add(k); setTouched(tch); setState((s) => prefill({ ...s, [k]: v }, data, tch)); };
  const reset = (k) => { const tch = new Set(touched); tch.delete(k); setTouched(tch); setState((s) => prefill(s, data, tch)); };
  const settle = useMemo(() => { if (!data || !state) return null; const perBed = (u) => (u.settleMonthly != null && u.beds ? u.settleMonthly / u.beds : null); if (state.type === 'WH') { const us = data.property.units.filter((u) => u.settleMonthly != null); const beds = us.reduce((s, u) => s + u.beds, 0); return beds ? us.reduce((s, u) => s + u.settleMonthly, 0) / beds : null; } return perBed(data.unit); }, [data, state && state.type]);
  if (!row) return null;
  const changesPreview = data && state ? buildLeaseChanges(state, data, data.ids, LEASE) : [];
  // Overlap: the new dates may not touch an existing lease on the same beds; each hit must be ended early or archived first.
  const scope = data && state ? leaseScope(state, data) : null;
  const conflicts = data && state && scope ? overlappingLeases(state.start, state.end, (data.existing || []).filter((l) => !resolutions[l.id]), scope) : [];
  const resolved = Object.entries(resolutions).map(([id, r]) => ({ lease: (data.existing || []).find((l) => l.id === id), ...r })).filter((x) => x.lease);
  const endEarly = (l) => setResolutions({ ...resolutions, [l.id]: { action: 'end', end: addDays(state.start, -1) } });
  const archive = (l) => setResolutions({ ...resolutions, [l.id]: { action: 'archive' } });
  const undo = (id) => { const r = { ...resolutions }; delete r[id]; setResolutions(r); };
  const monthlyPerLease = state && state.monthly;
  const breach = settle != null && state && state.rentPerBed != null && state.rentPerBed < settle;
  const create = async () => {
    setBusy(true); setResult(null);
    const boot = getBootstrap();
    const ayYear = ayForDate(state.start); const ayRow = boot && boot.academicYears.find((a) => a.year === ayYear);
    const fixes = resolved.map((x, i) => ({ changeId: `lease-fix:${x.lease.id}:${Date.now()}:${i}`, recordType: LEASE.TYPE, recordId: x.lease.id, version: x.lease.version || undefined, fields: x.action === 'archive' ? { isinactive: true } : { [LEASE.END]: x.end } }));
    const changes = [...fixes, ...changesPreview.map((c, i) => ({ ...c, changeId: `lease:${row.key}:${Date.now()}:${i}`, fields: { ...c.fields, ...(ayRow ? { [LEASE.AY]: Number(ayRow.id), name: String(c.fields.name).replace(/AY \d{2}-\d{2}$/, `AY ${String(ayYear).slice(2)}-${String(ayYear + 1).slice(2)}`) } : {}) } }))];
    // the captured terms shadow the lease on the status row (custrecord_ad_uas_lease_terms), when the field exists
    if (row.rowId && !row.leaseTermsOff) changes.push({ changeId: `terms:${row.key}:${Date.now()}`, recordType: UAS.TYPE, recordId: row.rowId, version: row.version, fields: { [UAS.LEASE_TERMS]: JSON.stringify({ type: state.type, twoYear: state.twoYear, start: state.start, end: state.end, rentPerBed: state.rentPerBed, groupType: state.groupType, bedroomIds: state.bedroomIds, water: state.water, gas: state.gas, provisions: state.provisions, notes: state.notes, expectedNames: state.expectedNames, capturedAt: new Date().toISOString() }) } });
    const res = await post('write', { changes });
    setBusy(false);
    const results = res.results || [];
    const created = results.filter((r) => r.ok && r.created);
    setResult({ results, created: created.length, failed: results.filter((r) => !r.ok), fixed: results.filter((r) => r.ok && !r.created).length });
    if (created.length) { invalidate('pipeline'); invalidate('leasedialog'); onCreated && onCreated(row, created); }
  };
  const foot = <div className="toolbar"><span className="muted small">{isPreview() ? 'Preview: nothing is written.' : resolved.length ? `${resolved.length} existing lease${resolved.length === 1 ? '' : 's'} will be updated first, then the new lease is created with no status.` : 'Creates the lease record with no status; set In Process once it is sent.'}</span><span className="spacer" /><Button small onClick={onClose}>Cancel</Button><Button kind="primary" small disabled={busy || !state || !state.start || !state.end || state.rentPerBed == null || (state.type === 'BED' && !(state.bedroomIds || []).length) || conflicts.length > 0} onClick={create}>{busy ? 'Creating…' : changesPreview.length > 1 ? `Create ${changesPreview.length} lease records` : 'Create lease record'}</Button></div>;
  return (
    <Modal open onClose={onClose} title={<span>Lease terms · {row.unit === '(whole property)' ? row.property : row.unit} <span className="muted small">{row.property}</span></span>} foot={foot} width={760}>
      {!row.unitId ? <p className="muted">This property has no unit records, so a lease cannot be linked here. Create the Units/Bedrooms records first.</p>
        : error ? <ErrorBox error={error} /> : loading || !data || !state ? <Skeleton rows={6} cols={2} /> : (
          <div className="lease-form">
            <div className="form-row">
              <Select label="Lease type" value={state.type} onChange={(v) => set('type', v, false)} options={Object.values(LEASE_TYPES).map((t) => ({ value: t.key, label: t.label }))} />
              <Select label="Group" value={state.groupType} onChange={(v) => set('groupType', v, false)} options={GROUP_TYPES.map((g) => ({ value: g.key, label: g.label }))} />
              <Toggle label="Two-year lease" checked={state.twoYear} onChange={(v) => set('twoYear', v, false)} />
            </div>
            {state.type === 'WH' && <p className="muted small">A whole-house lease covers every unit at {data.property.name}: {data.property.units.map((u) => `${u.name} (${u.beds})`).join(', ')}. It is written with no unit link, which is how the engine reads “whole property”.</p>}
            {state.type === 'BED' && <div className="form-row wrap"><span className="field-label">Bedrooms</span>{data.unit.bedrooms.map((b) => <label key={b.id} className="toggle"><input type="checkbox" checked={(state.bedroomIds || []).includes(b.id)} onChange={(e) => set('bedroomIds', e.target.checked ? [...(state.bedroomIds || []), b.id] : (state.bedroomIds || []).filter((x) => x !== b.id))} /><span>{b.name} ({b.beds}){!b.free && <Pill tone="muted">taken</Pill>}</span></label>)}{touched.has('bedroomIds') && <button type="button" className="linkish small" onClick={() => reset('bedroomIds')}>reset to free bedrooms</button>}</div>}
            <div className="form-row">
              <label className="field"><span className="field-label">Start {touched.has('start') && <button type="button" className="linkish" onClick={() => reset('start')}>calendar</button>}</span><input type="date" value={state.start || ''} onChange={(e) => set('start', e.target.value)} /></label>
              <label className="field"><span className="field-label">End {touched.has('end') && <button type="button" className="linkish" onClick={() => reset('end')}>calendar</button>}</span><input type="date" value={state.end || ''} onChange={(e) => set('end', e.target.value)} /></label>
              <label className="field"><span className="field-label">Term</span><span className="field-static">{state.termMonths != null ? `${state.termMonths} months` : '–'}</span></label>
              {state.calendarMissing && <span className="warn-text small">No lease calendar is configured for this market (see ASSUMPTIONS A-4); enter the dates.</span>}
            </div>
            {(data.existing || []).length > 0 && <div className="existing-leases small">
              <span className="field-label">Leases already on {state.type === 'WH' ? 'this property' : 'this unit'}</span>
              <ul>{data.existing.map((l) => { const r = resolutions[l.id]; const hit = conflicts.some((c) => c.id === l.id); return <li key={l.id} className={hit ? 'conflict' : r ? 'resolved' : ''}><a className="link" href={recordUrl('lease', l.id)} target="_blank" rel="noreferrer">{l.name}</a> <span className="muted">{fmtDate(l.start)} – {fmtDate(l.end)}{l.level === 'bedroom' ? ` · ${l.bedroomName}` : l.level === 'property' ? ' · whole property' : ''}{l.statusKey && l.statusKey !== 'NONE' ? ` · ${l.statusKey === 'EXECUTED' ? 'executed' : 'in process'}` : ' · no status'}</span>{r && <span className="warn-text"> → {r.action === 'archive' ? 'will be archived' : `will end ${fmtDate(r.end)}`} <button type="button" className="linkish" onClick={() => undo(l.id)}>undo</button></span>}</li>; })}</ul>
            </div>}
            {conflicts.length > 0 && <div className="errorbox small">
              <strong>These dates overlap {conflicts.length === 1 ? 'an existing lease' : `${conflicts.length} existing leases`}.</strong> A bed can only be on one lease at a time. Move the dates to free months, or for each one choose: end it early (its end date becomes {fmtDate(addDays(state.start, -1))}, the day before this lease starts) or archive it (made inactive; nothing is deleted).
              <ul>{conflicts.map((l) => <li key={l.id}>{l.name} <span className="muted">{fmtDate(l.start)} – {fmtDate(l.end)}</span> <Button small onClick={() => endEarly(l)}>End early</Button> <Button small onClick={() => archive(l)}>Archive</Button></li>)}</ul>
            </div>}
            <div className="form-row">
              <label className="field"><span className="field-label">Rent per bed {touched.has('rentPerBed') && <button type="button" className="linkish" onClick={() => reset('rentPerBed')}>target</button>}</span><input type="number" step="5" min="0" value={state.rentPerBed == null ? '' : Math.round(state.rentPerBed * 100) / 100} onChange={(e) => set('rentPerBed', e.target.value === '' ? null : Number(e.target.value))} /></label>
              <label className="field"><span className="field-label">Beds covered</span><span className="field-static">{fmtInt(state.bedsCovered)}</span></label>
              <label className="field"><span className="field-label">Monthly {state.type === 'BED' ? 'per bedroom' : ''}</span><span className="field-static">{fmtMoney2(monthlyPerLease)}</span></label>
              <label className="field"><span className="field-label">Total</span><span className="field-static">{fmtMoney(state.total)}</span></label>
            </div>
            {settle != null && <p className={`small ${breach ? 'warn-text' : 'muted'}`}>{breach ? `${fmtMoney2(state.rentPerBed)} per bed is below the ${fmtMoney2(settle)} settle floor for ${state.type === 'BED' ? 'these bedrooms' : 'this unit'}.` : `At or above the ${fmtMoney2(settle)} settle floor.`}</p>}
            {state.rentPerBed == null && <p className="warn-text small">No target rent for this academic year: enter the rent per bed.</p>}
            <div className="form-row">
              <label className="field grow"><span className="field-label">Expected tenants (one per line) {touched.has('expectedNames') && <button type="button" className="linkish" onClick={() => reset('expectedNames')}>reset</button>}</span><textarea rows={3} value={state.expectedNames || ''} onChange={(e) => set('expectedNames', e.target.value)} placeholder={state.groupType === 'RENEWAL' ? 'Prior tenants fill in for a renewal' : 'Names…'} /></label>
              <div className="field"><span className="field-label">Utilities</span><Toggle label="Water included" checked={state.water} onChange={(v) => set('water', v, false)} /><Toggle label="Gas included" checked={state.gas} onChange={(v) => set('gas', v, false)} /></div>
            </div>
            <div className="form-row"><label className="field grow"><span className="field-label">Additional provisions</span><textarea rows={2} value={state.provisions || ''} onChange={(e) => set('provisions', e.target.value, false)} /></label><label className="field grow"><span className="field-label">Notes</span><textarea rows={2} value={state.notes || ''} onChange={(e) => set('notes', e.target.value, false)} /></label></div>
            <details className="small"><summary className="muted">What will be written ({changesPreview.length} lease record{changesPreview.length === 1 ? '' : 's'}, no status)</summary><ul className="muted">{changesPreview.map((c, i) => <li key={i}>{c.fields.name}: {fmtDate(c.fields[LEASE.START])} – {fmtDate(c.fields[LEASE.END])} · {fmtMoney2(c.fields[LEASE.MONTHLY_RENT])}/mo · {c.fields[LEASE.TENANT_COUNT]} tenant(s){c.fields[LEASE.UNIT] ? ` · link #${c.fields[LEASE.UNIT]}` : ' · whole property'}</li>)}</ul></details>
            {result && <div className={`${result.failed.length ? 'errorbox' : 'okbox'} small`}>{result.fixed ? `Updated ${result.fixed} existing lease${result.fixed === 1 ? '' : 's'}. ` : ''}{result.created ? `Created ${result.created} lease record${result.created === 1 ? '' : 's'}.` : ''} {result.failed.map((f, i) => <div key={i}>{f.code}: {f.message}</div>)}</div>}
          </div>
        )}
    </Modal>
  );
}
