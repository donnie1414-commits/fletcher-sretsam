/**
 * THE dropdown: a button that opens a popover menu, rendered in a portal so grid cells and drawers never clip it.
 * Keyboard: ↓/↑ move, Enter/Space choose, Esc closes, typing jumps to a matching option. On touch devices it falls
 * back to the native <select>, which is the better control there. Same props as the old Select.
 */
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../ui.jsx';

const coarse = () => { try { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };

export function Dropdown({ label, value, onChange, options, id, renderValue, renderOption, placeholder = '…', small, className, align = 'left', disabled, title, ariaLabel }) {
  const auto = useId(); const sid = id || auto;
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState(null);
  const btn = useRef(null); const pop = useRef(null); const typed = useRef({ s: '', t: 0 });
  const opts = options.map((o) => (typeof o === 'object' && o !== null ? o : { value: o, label: String(o) }));
  const cur = opts.find((o) => String(o.value ?? '') === String(value ?? ''));
  const native = coarse();
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const maxH = Math.max(160, Math.min(360, below > 240 ? below - 12 : r.top - 12));
    setPos({ top: below > 240 || r.top < 240 ? r.bottom + 4 : null, bottom: below > 240 || r.top < 240 ? null : window.innerHeight - r.top + 4, left: align === 'right' ? null : r.left, right: align === 'right' ? window.innerWidth - r.right : null, minWidth: r.width, maxH });
    setHi(Math.max(0, opts.findIndex((o) => o === cur)));
  }, [open]); // eslint-disable-line
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (btn.current && btn.current.contains(e.target)) return; if (pop.current && pop.current.contains(e.target)) return; setOpen(false); };
    const scroll = (e) => { if (pop.current && pop.current.contains(e.target)) return; setOpen(false); };
    document.addEventListener('mousedown', down); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [open]);
  useEffect(() => { if (open && pop.current && hi >= 0) { const el = pop.current.children[hi]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } }, [hi, open]);
  const choose = (o) => { setOpen(false); if (o && !o.disabled && String(o.value ?? '') !== String(value ?? '')) onChange(o.value); btn.current && btn.current.focus(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setOpen(true); return; }
    if (!open) return;
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); } else if (e.key === 'End') { e.preventDefault(); setHi(opts.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(opts[hi]); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { const now = Date.now(); typed.current = { s: (now - typed.current.t < 800 ? typed.current.s : '') + e.key.toLowerCase(), t: now }; const i = opts.findIndex((o) => String(o.label).toLowerCase().startsWith(typed.current.s)); if (i >= 0) setHi(i); }
  };
  const control = native
    ? <select id={sid} className={cx('dd-native', small && 'dd-sm')} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel || label} onClick={(e) => e.stopPropagation()}>{opts.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select>
    : <button type="button" id={sid} ref={btn} className={cx('dd-btn', small && 'dd-sm', open && 'is-open', !cur && 'is-empty')} disabled={disabled} title={title} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel || label} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onKeyDown={onKey}>
        <span className="dd-val">{cur ? (renderValue ? renderValue(cur) : cur.label) : placeholder}</span><span className="dd-chev" aria-hidden="true">▾</span>
      </button>;
  const menu = open && !native && pos ? createPortal(
    <div ref={pop} className="dd-pop" role="listbox" aria-activedescendant={hi >= 0 ? `${sid}-o${hi}` : undefined} style={{ top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', left: pos.left ?? 'auto', right: pos.right ?? 'auto', minWidth: pos.minWidth, maxHeight: pos.maxH }} onMouseDown={(e) => e.preventDefault()}>
      {opts.map((o, i) => <div key={o.value ?? i} id={`${sid}-o${i}`} role="option" aria-selected={o === cur} className={cx('dd-opt', i === hi && 'is-hi', o === cur && 'is-cur', o.disabled && 'is-disabled')} onMouseEnter={() => setHi(i)} onClick={(e) => { e.stopPropagation(); choose(o); }}>{renderOption ? renderOption(o) : o.label}{o.count != null && <span className="dd-count">{o.count}</span>}</div>)}
    </div>, document.body) : null;
  if (!label) return <span className={cx('dd', className)}>{control}{menu}</span>;
  return <label className={cx('field', 'dd', className)} htmlFor={sid}><span className="field-label">{label}</span>{control}{menu}</label>;
}
