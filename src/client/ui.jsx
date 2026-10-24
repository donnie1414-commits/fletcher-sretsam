import { useState, useId } from 'react';
import { fmtDelta } from './format.js';

export const cx = (...a) => a.filter(Boolean).join(' ');
export function Button({ kind = 'default', small, children, ...rest }) { return <button type="button" className={cx('btn', kind !== 'default' && `btn-${kind}`, small && 'btn-sm')} {...rest}>{children}</button>; }
export function Select({ label, value, onChange, options, id, ...rest }) {
  const auto = useId(); const sid = id || auto;
  return <label className="field" htmlFor={sid}>{label && <span className="field-label">{label}</span>}<select id={sid} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select></label>;
}
export function Segmented({ value, onChange, options, ariaLabel }) {
  return <div className="seg" role="tablist" aria-label={ariaLabel}>{options.map((o) => <button type="button" role="tab" key={o.value} aria-selected={value === o.value} className={cx('seg-item', value === o.value && 'is-on')} onClick={() => onChange(o.value)}>{o.label}{o.count != null && <span className="seg-count">{o.count}</span>}</button>)}</div>;
}
export function Figure({ label, value, delta, deltaKind, hint, warn }) {
  return <div className={cx('figure', warn && 'is-warn')}><div className="figure-label">{label}</div><div className="figure-value">{value}</div>{(delta != null || hint) && <div className="figure-delta">{delta != null ? <span className={cx(delta > 0 && 'up', delta < 0 && 'down')}>{fmtDelta(delta, deltaKind)}</span> : null}{hint && <span className="muted"> {hint}</span>}</div>}</div>;
}
export function Disclosure({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="disclosure"><button type="button" className="disclosure-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>{summary}</button>{open && <div className="disclosure-body">{children}</div>}</section>;
}
export function Skeleton({ rows = 6, cols = 5 }) { return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div className="sk-row" key={i}>{Array.from({ length: cols }).map((__, j) => <span className="sk-cell" key={j} style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />)}</div>)}</div>; }
export function Empty({ title, body, action }) { return <div className="empty"><div className="empty-title">{title}</div>{body && <p className="muted">{body}</p>}{action}</div>; }
export function ErrorBox({ error }) { return <div className="errorbox" role="alert"><strong>Could not load.</strong> {error.message}</div>; }
export function Pill({ children, tone }) { return <span className={cx('pill', tone && `pill-${tone}`)}>{children}</span>; }
export function Drawer({ open, onClose, title, children, width = 560 }) {
  if (!open) return null;
  return <div className="drawer-root"><div className="drawer-scrim" onClick={onClose} /><aside className="drawer" style={{ width: `min(${width}px, 100vw)` }} role="dialog" aria-label={title}><header className="drawer-head"><h2>{title}</h2><Button small onClick={onClose} aria-label="Close">✕</Button></header><div className="drawer-body">{children}</div></aside></div>;
}
export function Toggle({ label, checked, onChange }) { const id = useId(); return <label className="toggle" htmlFor={id}><input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>; }
export function Dot({ level }) { return <span className={cx('dot', `dot-${level}`)} aria-hidden="true" />; }
