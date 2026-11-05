/** Sorting for every table: a cell's sort value is its own number or text, read from what the cell renders when no sortValue is given. */
export function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props) return textOf(node.props.children);
  return '';
}
/** Numbers stay numbers; "$1,234", "45.3%", "−3.2 pts", "+12" parse to numbers; "–" and blanks sort last; anything else sorts as text. */
export function sortValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = (typeof v === 'string' ? v : textOf(v)).trim();
  if (!s || s === '–' || s === '—' || s === '-') return null;
  if (/^[+\-−–]?\s?\$?[\d.,]+/.test(s)) { const n = parseFloat(s.replace(/[−–]/g, '-').replace(/[^\d.\-+]/g, '')); if (Number.isFinite(n)) return n; }
  return s.toLowerCase();
}
/** Compare two sort values; blanks always last, whichever the direction. */
export function compareBy(a, b, dir = 1) {
  if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
  return c * dir;
}
export function nextSort(cur, key) { return { key, dir: cur && cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc' }; }
export function sortRows(rows, sort, valueOf) {
  if (!sort) return rows;
  const dir = sort.dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: valueOf(r) })).sort((a, b) => compareBy(a.v, b.v, dir) || a.i - b.i).map((x) => x.r);
}
