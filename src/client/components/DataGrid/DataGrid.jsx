/**
 * THE grid (§4.1). Configured four times (Pipeline, Portfolio, Tenants, Exceptions), never copied.
 *  - keyed row state: edits live in a {rowKey: {field: value}} map owned by the screen; typing in one
 *    row re-renders that row only (Row is memoised on its own inputs)
 *  - columns declare type, editability, options, validation, csv
 *  - virtualized with variable heights (a row can expand an inline panel), sticky header + first column
 *  - multi-select with "apply to selected", keyboard-first navigation, paste-a-column
 *  - per-row save result rendered inline
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtInt, fmtMoney, fmtPct, fmtDate } from '../../format.js';
import { cx } from '../../ui.jsx';

export const ROW_H = { comfortable: 40, compact: 30 };

function defaultFormat(col, v) {
  if (v == null || v === '') return '';
  switch (col.type) {
    case 'number': return fmtInt(v);
    case 'money': return fmtMoney(v);
    case 'pct': return fmtPct(v);
    case 'date': return fmtDate(v);
    case 'select': { const o = (typeof col.options === 'function' ? [] : col.options || []).find((x) => String(x.value) === String(v)); return o ? o.label : String(v); }
    default: return String(v);
  }
}
const isEditable = (col, row) => (typeof col.editable === 'function' ? col.editable(row) : !!col.editable);
const cellValue = (col, row, edits) => (edits && col.key in edits ? edits[col.key] : typeof col.value === 'function' ? col.value(row) : row[col.key]);

const Cell = memo(function Cell({ col, row, edits, focused, editing, onFocus, onStartEdit, onCommit, onCancel }) {
  const raw = cellValue(col, row, edits);
  const editable = isEditable(col, row);
  const dirty = !!(edits && col.key in edits);
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); if (ref.current.select && col.type !== 'select') ref.current.select(); } }, [editing, col.type]);
  let body;
  if (editing && editable) {
    const commit = (v) => onCommit(col, row, v);
    const common = { ref, className: 'cell-input', onBlur: (e) => commit(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { commit(e.target.value); e.preventDefault(); } else if (e.key === 'Escape') { onCancel(); e.preventDefault(); } else if (e.key === 'Tab') { commit(e.target.value); } } };
    if (col.type === 'select') { const opts = typeof col.options === 'function' ? col.options(row) : col.options || []; body = <select {...common} defaultValue={raw ?? ''} onChange={(e) => commit(e.target.value)}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; }
    else if (col.type === 'date') body = <input {...common} type="date" defaultValue={raw || ''} />;
    else if (col.type === 'number' || col.type === 'money') body = <input {...common} type="number" step={col.step || 'any'} defaultValue={raw ?? ''} inputMode="decimal" />;
    else body = <input {...common} type="text" defaultValue={raw ?? ''} />;
  } else body = col.render ? col.render(raw, row) : defaultFormat(col, raw);
  return (
    <div role="gridcell" tabIndex={focused ? 0 : -1} aria-selected={focused} className={cx('cell', col.align === 'right' && 'num', editable && 'editable', dirty && 'dirty', col.sticky && 'sticky-col', col.className)} style={{ width: col.width }} title={col.title ? col.title(raw, row) : undefined}
      onClick={() => { onFocus(); if (editable && col.type !== 'select') onStartEdit(); }}>
      {body}
    </div>
  );
});

const Row = memo(function Row({ row, rowKey, cols, edits, result, selected, onSelect, focusCol, editingCol, onFocusCell, onStartEdit, onCommit, onCancel, style, selectable, index, rowH, expanded, renderExpanded, expandedHeight }) {
  return (
    <div className={cx('rowwrap', expanded && 'is-expanded')} style={style}>
      <div role="row" aria-rowindex={index + 2} className={cx('row', edits && Object.keys(edits).length && 'is-dirty', result && (result.ok ? 'saved' : 'failed'), selected && 'is-selected', row.depth != null && `depth-${Math.min(row.depth, 5)}`)} style={{ height: rowH }}>
        {selectable && <div className="cell sel sticky-col" role="gridcell"><input type="checkbox" aria-label="Select row" checked={!!selected} onChange={(e) => onSelect(rowKey, e.target.checked, e.nativeEvent.shiftKey)} /></div>}
        {cols.map((col, ci) => <Cell key={col.key} col={col} row={row} edits={edits} focused={focusCol === ci} editing={editingCol === ci} onFocus={() => onFocusCell(ci)} onStartEdit={() => onStartEdit(ci)} onCommit={onCommit} onCancel={onCancel} />)}
        {result && !result.ok && <div className="row-result" role="status">{result.message}</div>}
      </div>
      {expanded && <div className="row-expand" style={{ height: expandedHeight }}>{renderExpanded(row)}</div>}
    </div>
  );
});

export function DataGrid({ columns, rows, rowKey = 'key', edits = {}, onEdit, results = {}, selection, onSelectionChange, sort, onSort, loading, empty, density = 'comfortable', rowHeight, height = 'calc(100vh - 220px)', cardRenderer, isMobile, footer, expanded, renderExpanded, expandedHeight = 320, className }) {
  const cols = useMemo(() => columns.map((c, i) => ({ sticky: i === 0, align: ['number', 'money', 'pct'].includes(c.type) ? 'right' : 'left', ...c })), [columns]);
  const rowH = (rowHeight && rowHeight[density]) || ROW_H[density] || ROW_H.comfortable;
  const scroller = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [focus, setFocus] = useState({ r: -1, c: 0 });
  const [editing, setEditing] = useState(null); // { r, c }
  const lastSel = useRef(null);
  useEffect(() => { const el = scroller.current; if (!el) return undefined; const ro = new ResizeObserver(() => setViewH(el.clientHeight)); ro.observe(el); setViewH(el.clientHeight); return () => ro.disconnect(); }, []);
  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), []);
  const total = rows.length;
  const keyOf = (row) => String(typeof rowKey === 'function' ? rowKey(row) : row[rowKey]);
  // variable heights: an expanded row carries its panel below it
  const { offsets, heights, totalH } = useMemo(() => { const offsets = new Array(total), heights = new Array(total); let acc = 0; for (let i = 0; i < total; i++) { const h = rowH + (expanded && expanded.has(keyOf(rows[i])) ? expandedHeight : 0); offsets[i] = acc; heights[i] = h; acc += h; } return { offsets, heights, totalH: acc }; }, [rows, rowH, expanded, expandedHeight]); // eslint-disable-line
  const findIndex = (y) => { let lo = 0, hi = total - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid] + heights[mid] <= y) lo = mid + 1; else hi = mid; } return lo; };
  const start = total ? Math.max(0, findIndex(Math.max(0, scrollTop - 6 * rowH))) : 0;
  const end = total ? Math.min(total, findIndex(scrollTop + viewH + 6 * rowH) + 1) : 0;

  const commit = useCallback((col, row, v) => {
    setEditing(null);
    let val = v;
    if (col.type === 'number' || col.type === 'money') val = v === '' ? null : Number(v);
    if (col.type === 'select' && v === '') val = null;
    const prev = typeof col.value === 'function' ? col.value(row) : row[col.key];
    if (String(prev ?? '') === String(val ?? '')) return;
    if (col.validate) { const msg = col.validate(val, row); if (msg) { onEdit && onEdit(keyOf(row), col.key, val, msg); return; } }
    onEdit && onEdit(keyOf(row), col.key, val);
  }, [onEdit]); // eslint-disable-line
  const select = useCallback((k, on, shift) => {
    if (!onSelectionChange) return;
    const next = new Set(selection || []);
    if (shift && lastSel.current != null) { const a = rows.findIndex((r) => keyOf(r) === lastSel.current), b = rows.findIndex((r) => keyOf(r) === k); const [lo, hi] = a < b ? [a, b] : [b, a]; for (let i = lo; i <= hi; i++) on ? next.add(keyOf(rows[i])) : next.delete(keyOf(rows[i])); }
    else on ? next.add(k) : next.delete(k);
    lastSel.current = k; onSelectionChange(next);
  }, [rows, selection, onSelectionChange]); // eslint-disable-line
  const allSelected = selection && rows.length > 0 && rows.every((r) => selection.has(keyOf(r)));

  const onKeyDown = (e) => {
    if (editing) return;
    if (!rows.length) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((e.target || {}).tagName || '')) return;
    const r = Math.max(0, focus.r), c = focus.c;
    const move = (dr, dc) => { const nr = Math.min(total - 1, Math.max(0, r + dr)), nc = Math.min(cols.length - 1, Math.max(0, c + dc)); setFocus({ r: nr, c: nc }); const el = scroller.current; if (el) { const top = offsets[nr]; if (top < el.scrollTop) el.scrollTop = top; else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight; } e.preventDefault(); };
    if (e.key === 'ArrowDown') move(1, 0); else if (e.key === 'ArrowUp') move(-1, 0); else if (e.key === 'ArrowRight') move(0, 1); else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'PageDown') move(Math.floor(viewH / rowH), 0); else if (e.key === 'PageUp') move(-Math.floor(viewH / rowH), 0);
    else if (e.key === 'Home') move(-total, 0); else if (e.key === 'End') move(total, 0);
    else if (e.key === 'Tab') { let nc = c + (e.shiftKey ? -1 : 1), nr = r; while (nr >= 0 && nr < total) { while (nc >= 0 && nc < cols.length) { if (isEditable(cols[nc], rows[nr])) { setFocus({ r: nr, c: nc }); e.preventDefault(); return; } nc += e.shiftKey ? -1 : 1; } nr += e.shiftKey ? -1 : 1; nc = e.shiftKey ? cols.length - 1 : 0; } }
    else if (e.key === 'Enter' || e.key === 'F2') { if (isEditable(cols[c], rows[r])) { setEditing({ r, c }); e.preventDefault(); } }
    else if (e.key === ' ' && onSelectionChange) { const k = keyOf(rows[r]); select(k, !(selection && selection.has(k)), false); e.preventDefault(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && isEditable(cols[c], rows[r])) { setEditing({ r, c }); }
  };
  // paste a column from Excel onto text/date/number cells starting at the focused cell
  const onPaste = (e) => {
    if (editing || focus.r < 0) return;
    const col = cols[focus.c]; if (!col || !['text', 'date', 'number', 'money'].includes(col.type || 'text')) return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain'); if (!text) return;
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
    if (lines.length < 1) return;
    e.preventDefault();
    lines.forEach((line, i) => { const row = rows[focus.r + i]; if (!row || !isEditable(col, row)) return; let v = line.split('\t')[0].trim(); if (col.type === 'date') v = normalizeDate(v); if (col.type === 'number' || col.type === 'money') v = v === '' ? null : Number(v.replace(/[$,]/g, '')); onEdit && onEdit(keyOf(row), col.key, v); });
  };

  if (isMobile && cardRenderer) {
    return <div className="cards">{loading ? <div className="muted">Loading…</div> : rows.length ? rows.map((row) => <div key={keyOf(row)} className={cx('card', edits[keyOf(row)] && 'is-dirty')}>{cardRenderer(row, edits[keyOf(row)] || {}, results[keyOf(row)])}</div>) : <div className="empty"><div className="empty-title">{empty?.title || 'Nothing here'}</div><p className="muted">{empty?.body}</p></div>}{footer}</div>;
  }
  const widthTotal = cols.reduce((s, c) => s + (parseInt(c.width, 10) || 140), 0) + (onSelectionChange ? 36 : 0);
  return (
    <div className={cx('grid', `density-${density}`, className)} role="grid" aria-rowcount={total + 1} aria-colcount={cols.length} onKeyDown={onKeyDown} onPaste={onPaste} tabIndex={0} style={{ height }}>
      <div className="grid-scroll" ref={scroller} onScroll={onScroll}>
        <div className="grid-inner" style={{ minWidth: widthTotal }}>
          <div className="head" role="row">
            {onSelectionChange && <div className="cell sel sticky-col" role="columnheader"><input type="checkbox" aria-label="Select all" checked={!!allSelected} onChange={(e) => onSelectionChange(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} /></div>}
            {cols.map((col) => <div key={col.key} role="columnheader" aria-sort={sort && sort.key === col.key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'} className={cx('cell', 'th', col.align === 'right' && 'num', col.sticky && 'sticky-col', col.sortable !== false && onSort && 'sortable')} style={{ width: col.width }} onClick={() => col.sortable !== false && onSort && onSort(col.key)}>{col.label}{col.unit && <span className="unit"> {col.unit}</span>}{sort && sort.key === col.key && <span className="sort-ind">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span>}</div>)}
          </div>
          {loading ? <div className="grid-loading">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="row sk" style={{ height: rowH }}>{cols.map((c) => <span key={c.key} className="sk-cell" style={{ width: c.width }} />)}</div>)}</div>
            : !rows.length ? <div className="empty"><div className="empty-title">{empty?.title || 'Nothing here'}</div>{empty?.body && <p className="muted">{empty.body}</p>}{empty?.action}</div>
            : <div className="body" style={{ height: totalH, position: 'relative' }}>
              {rows.slice(start, end).map((row, i) => { const k = keyOf(row); const ri = start + i; const isX = !!(expanded && expanded.has(k) && renderExpanded); return <Row key={k} index={ri} row={row} rowKey={k} cols={cols} edits={edits[k]} result={results[k]} selected={selection && selection.has(k)} onSelect={select} selectable={!!onSelectionChange} focusCol={focus.r === ri ? focus.c : -1} editingCol={editing && editing.r === ri ? editing.c : -1} onFocusCell={(c) => setFocus({ r: ri, c })} onStartEdit={(c) => setEditing({ r: ri, c })} onCommit={commit} onCancel={() => setEditing(null)} rowH={rowH} expanded={isX} renderExpanded={renderExpanded} expandedHeight={expandedHeight} style={{ position: 'absolute', top: offsets[ri], height: heights[ri], left: 0, right: 0 }} />; })}
            </div>}
        </div>
      </div>
      {footer}
    </div>
  );
}
function normalizeDate(v) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return v; }
