import { useState, useId, useEffect } from 'react';
import { fmtDelta, isNum, sign } from './format.js';

export const cx = (...a) => a.filter(Boolean).join(' ');
export function Button({ kind = 'default', small, children, ...rest }) { return <button type="button" className={cx('btn', kind !== 'default' && `btn-${kind}`, small && 'btn-sm')} {...rest}>{children}</button>; }
export function Select({ label, value, onChange, options, id, ...rest }) {
  const auto = useId(); const sid = id || auto;
  return <label className="field" htmlFor={sid}>{label && <span className="field-label">{label}</span>}<select id={sid} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.value ?? o} value={o.value ?? o} disabled={o.disabled}>{o.label ?? o}</option>)}</select></label>;
}
export function Segmented({ value, onChange, options, ariaLabel }) {
  return <div className="seg" role="tablist" aria-label={ariaLabel}>{options.map((o) => <button type="button" role="tab" key={o.value} aria-selected={value === o.value} className={cx('seg-item', value === o.value && 'is-on')} onClick={() => onChange(o.value)}>{o.label}{o.count != null && <span className="seg-count">{o.count}</span>}</button>)}</div>;
}
export function Figure({ label, value, delta, deltaKind, hint, warn }) {
  return <div className={cx('figure', warn && 'is-warn')}><div className="figure-label">{label}</div><div className="figure-value">{value}</div>{(delta != null || hint) && <div className="figure-delta">{delta != null ? <span className={cx(delta > 0 && 'up', delta < 0 && 'down')}>{fmtDelta(delta, deltaKind)}</span> : null}{hint && <span className="muted"> {hint}</span>}</div>}</div>;
}
/** A signed delta with direction colouring: pass the formatted string via fmt. */
export function Delta({ v, fmt = fmtDelta, invert = false }) {
  if (!isNum(v)) return <span className="muted">–</span>;
  const dir = Math.abs(v) < 0.00005 ? '' : (v > 0) !== invert ? 'up' : 'down';
  return <span className={cx('delta', dir)}>{fmt(v)}</span>;
}
/** KPI tile (v2 "tile"): a headline, optional tone, up to three comparison rows [label, value, deltaNode], a footnote. */
export function Tile({ label, value, tone, rows = [], note, big }) {
  return (
    <div className={cx('tile', tone && `tone-${tone}`, big && 'tile-big')}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {rows.filter(Boolean).map((r, i) => <div className="tile-row" key={i}><span className="muted">{r[0]}</span><strong>{r[1]}</strong>{r[2] != null && <span className="tile-delta">{r[2]}</span>}</div>)}
      {note && <div className="tile-note muted small">{note}</div>}
    </div>
  );
}
/** Small stat used in strips and bands: a number over a label. */
export function Stat({ value, label, tone, sub }) { return <div className={cx('stat', tone && `tone-${tone}`)}><b>{value}</b><span>{label}</span>{sub && <small className="muted">{sub}</small>}</div>; }
export function Disclosure({ summary, children, defaultOpen = false, onToggle }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="disclosure"><button type="button" className="disclosure-toggle" aria-expanded={open} onClick={() => { setOpen(!open); onToggle && onToggle(!open); }}><span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>{summary}</button>{open && <div className="disclosure-body">{children}</div>}</section>;
}
/** A titled block with an always-visible head and optional count; body hidden behind a Detail disclosure when `fold`. */
export function Section({ title, count, note, children, strip, fold = false, defaultOpen = false, id, actions }) {
  return (
    <section className="sec" id={id}>
      <div className="sec-head"><div><h3>{title}{count != null && <em className="sec-count">{count}</em>}</h3>{note && <p className="sec-note muted small">{note}</p>}</div>{actions && <div className="sec-actions">{actions}</div>}</div>
      {strip}
      {fold ? <Disclosure summary="Detail" defaultOpen={defaultOpen}>{children}</Disclosure> : children}
    </section>
  );
}
/** Dense table for small lists: cols = [{ label, value(r), align:'l'|'r', title }]. Keeps the markup in one place. */
export function Table({ cols, rows, keyOf = (r, i) => r.id ?? i, foot, empty = 'Nothing here', rowClass, notes, maxHeight }) {
  return (
    <div className="wrap" style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
      <table className="dense">
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.align === 'l' ? 'l' : ''} title={c.title}>{c.label}</th>)}</tr>{notes && <tr className="notes">{cols.map((c, i) => <td key={i} className="l muted small">{c.note || ''}</td>)}</tr>}</thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={keyOf(r, i)} className={rowClass ? rowClass(r) : undefined}>{cols.map((c, j) => <td key={j} className={c.align === 'l' ? 'l' : ''}>{c.value(r)}</td>)}</tr>) : <tr><td colSpan={cols.length} className="l muted empty-cell">{empty}</td></tr>}</tbody>
        {foot && rows.length > 0 && <tfoot><tr>{cols.map((c, i) => <td key={i} className={c.align === 'l' ? 'l' : ''}>{c.foot ? c.foot(foot) : ''}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}
export function Skeleton({ rows = 6, cols = 5 }) { return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div className="sk-row" key={i}>{Array.from({ length: cols }).map((__, j) => <span className="sk-cell" key={j} style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />)}</div>)}</div>; }
export function Empty({ title, body, action }) { return <div className="empty"><div className="empty-title">{title}</div>{body && <p className="muted">{body}</p>}{action}</div>; }
export function ErrorBox({ error }) { return <div className="errorbox" role="alert"><strong>Could not load.</strong> {error.message}</div>; }
export function Pill({ children, tone, title }) { return <span className={cx('pill', tone && `pill-${tone}`)} title={title}>{children}</span>; }
export function Drawer({ open, onClose, title, children, width = 560, subtitle, foot }) {
  useEffect(() => { if (!open) return undefined; const on = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', on); return () => document.removeEventListener('keydown', on); }, [open, onClose]);
  if (!open) return null;
  return <div className="drawer-root"><div className="drawer-scrim" onClick={onClose} /><aside className="drawer" style={{ width: `min(${width}px, 100vw)` }} role="dialog" aria-label={typeof title === 'string' ? title : 'Dialog'}><header className="drawer-head"><div><h2>{title}</h2>{subtitle && <div className="muted small">{subtitle}</div>}</div><Button small onClick={onClose} aria-label="Close">✕</Button></header><div className="drawer-body">{children}</div>{foot && <footer className="drawer-foot">{foot}</footer>}</aside></div>;
}
/** Centered modal dialog (lease dialog, bulk assign). Escape closes; the page's own buttons confirm. */
export function Modal({ open, onClose, title, children, width = 720, foot }) {
  useEffect(() => { if (!open) return undefined; const on = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', on); return () => document.removeEventListener('keydown', on); }, [open, onClose]);
  if (!open) return null;
  return <div className="modal-root"><div className="drawer-scrim" onClick={onClose} /><div className="modal" style={{ width: `min(${width}px, calc(100vw - 32px))` }} role="dialog" aria-label={typeof title === 'string' ? title : 'Dialog'}><header className="drawer-head"><h2>{title}</h2><Button small onClick={onClose} aria-label="Close">✕</Button></header><div className="modal-body">{children}</div>{foot && <footer className="drawer-foot">{foot}</footer>}</div></div>;
}
export function Toggle({ label, checked, onChange }) { const id = useId(); return <label className="toggle" htmlFor={id}><input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>; }
export function Dot({ level }) { return <span className={cx('dot', `dot-${level}`)} aria-hidden="true" />; }
export function OccPill({ r, d }) { if (!isNum(r)) return <span className="muted">–</span>; const tone = isNum(d) ? (d >= -0.0005 ? 'ok' : d >= -0.03 ? 'warn' : 'bad') : (r >= 0.95 ? 'ok' : r >= 0.8 ? 'warn' : 'bad'); return <span className={cx('pill', `pill-${r === 0 && d === 0 ? 'muted' : tone}`)}>{(r * 100).toFixed(1)}%</span>; }
export { sign };
