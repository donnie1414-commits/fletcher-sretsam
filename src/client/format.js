const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtInt = (v) => (v == null || isNaN(v) ? '–' : nf0.format(v));
export const fmtMoney = (v, dp = 0) => (v == null || isNaN(v) ? '–' : (dp ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '$' + nf0.format(Math.round(v))));
export const fmtPct = (v) => (v == null || isNaN(v) ? '–' : nf1.format(v * 100) + '%');
export const fmtDelta = (v, kind = 'int') => { if (v == null || isNaN(v) || v === 0) return v === 0 ? '±0' : '–'; const s = v > 0 ? '+' : '−'; const a = Math.abs(v); return s + (kind === 'pct' ? nf1.format(a * 100) + ' pt' : kind === 'money' ? '$' + nf0.format(Math.round(a)) : nf0.format(a)); };
export const fmtDate = (iso) => { if (!iso) return '–'; const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
export const ayShort = (y) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
export function toCSV(rows, columns) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [columns.map((c) => esc(c.label)).join(',')].concat(rows.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))).join('\n');
}
export function downloadCSV(name, text) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* preview sandboxes block downloads */ }
  return text;
}
