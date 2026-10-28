import { useState } from 'react';
/**
 * Several properties, and under each the units to see. Used by Add lead (properties/units of interest) and by Schedule
 * tour (the units a tour covers). `f` carries propertyIds[] and unitIds[]; `properties` is the lists route's property set.
 */
export function PickUnits({ f, setF, properties, label = 'Properties', hint = null, onChange }) {
  const [q, setQ] = useState('');
  const chosen = properties.filter((p) => f.propertyIds.includes(p.id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? properties.filter((p) => !f.propertyIds.includes(p.id) && (p.name.toLowerCase().includes(needle) || p.market.includes(needle))).slice(0, 12) : [];
  const update = (next) => { setF(next); onChange && onChange(next); };
  const toggleUnit = (id) => update({ ...f, unitIds: f.unitIds.includes(id) ? f.unitIds.filter((x) => x !== id) : [...f.unitIds, id] });
  const add = (p) => { update({ ...f, propertyIds: [...f.propertyIds, p.id] }); setQ(''); };
  const remove = (p) => update({ ...f, propertyIds: f.propertyIds.filter((x) => x !== p.id), unitIds: f.unitIds.filter((u) => !p.units.some((x) => x.id === u)) });
  const allOf = (p) => update({ ...f, unitIds: [...new Set([...f.unitIds, ...p.units.map((u) => u.id)])] });
  return (
    <div className="field grow pick-props">
      <span className="field-label">{label} {chosen.length ? <span className="muted">· {chosen.length}{f.unitIds.length ? ` · ${f.unitIds.length} unit${f.unitIds.length === 1 ? '' : 's'}` : ''}</span> : null}</span>
      {chosen.map((p) => <div key={p.id} className="pick-prop">
        <div className="pick-prop-head"><strong>{p.name}</strong> <span className="muted small">{p.market}</span> {p.units.length > 1 && <button type="button" className="linkish small" onClick={() => allOf(p)}>all units</button>} <button type="button" className="linkish small" onClick={() => remove(p)}>remove</button></div>
        {p.units.length ? <div className="pick-units">{p.units.map((u) => <label key={u.id} className="toggle"><input type="checkbox" checked={f.unitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} /><span>{u.name} <span className="muted">· {u.beds} bed{u.beds === 1 ? '' : 's'}</span></span></label>)}</div> : <span className="muted small">no unit records at this property (whole property)</span>}
      </div>)}
      <div className="search-pick"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={chosen.length ? 'Add another property…' : 'Type to find a property…'} />
        {matches.length > 0 && <ul className="hits">{matches.map((p) => <li key={p.id}><button type="button" onClick={() => add(p)}>{p.name} <span className="muted small">{p.market} · {p.units.length} unit{p.units.length === 1 ? '' : 's'}</span></button></li>)}</ul>}
      </div>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
/** "Prop A: Unit 1, Unit 2 · Prop B: whole property" for titles and the Event location. */
export function describeUnits(f, properties) {
  return properties.filter((p) => f.propertyIds.includes(p.id)).map((p) => { const us = p.units.filter((u) => f.unitIds.includes(u.id)); return us.length ? `${p.name}: ${us.map((u) => u.name.replace(`${p.name} `, '').replace(p.name, '').trim() || u.name).join(', ')}` : p.name; }).join(' · ');
}
