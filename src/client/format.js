const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const isNum = (v) => v != null && typeof v === 'number' && !isNaN(v);
export const fmtInt = (v) => (isNum(v) ? nf0.format(v) : '–');
export const fmtMoney = (v, dp = 0) => (isNum(v) ? (dp ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '$' + nf0.format(Math.round(v))) : '–');
export const fmtMoney2 = (v) => (isNum(v) ? '$' + nf2.format(v) : '–');
export const fmtMoneyK = (v) => (isNum(v) ? (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e5 ? `$${Math.round(v / 1e3)}K` : fmtMoney(v)) : '–');
export const fmtPct = (v) => (isNum(v) ? nf1.format(v * 100) + '%' : '–');
export const fmtDec = (v) => (isNum(v) ? nf1.format(v) : '–');
export const sign = (v) => (v > 1e-9 ? '+' : v < -1e-9 ? '−' : '');
/** Signed point difference between two percentages: +1.2 pts */
export const fmtPts = (v) => (isNum(v) ? `${sign(v)}${nf1.format(Math.abs(v) * 100)} pts` : '–');
/** Signed growth ratio: +3.4% */
export const fmtGrowth = (v) => (isNum(v) ? `${sign(v)}${nf1.format(Math.abs(v) * 100)}%` : '–');
export const fmtSigned = (v) => (isNum(v) ? `${sign(v)}${nf0.format(Math.abs(Math.round(v)))}` : '–');
export const fmtSignedMoney = (v) => (isNum(v) ? `${sign(v)}$${nf0.format(Math.abs(Math.round(v)))}` : '–');
export const fmtDelta = (v, kind = 'int') => { if (!isNum(v)) return '–'; if (v === 0) return '±0'; const s = v > 0 ? '+' : '−'; const a = Math.abs(v); return s + (kind === 'pct' ? nf1.format(a * 100) + ' pt' : kind === 'money' ? '$' + nf0.format(Math.round(a)) : kind === 'growth' ? nf1.format(a * 100) + '%' : nf0.format(a)); };
export const fmtDate = (iso) => { if (!iso) return '–'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${String(y).slice(2)}`; };
export const fmtDateLong = (iso) => { if (!iso) return '–'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${Number(d)}, ${y}`; };
export const ayShort = (y) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
export const ayFull = (y) => `Academic Year ${y}-${y + 1}`;
/** Occupancy tone: at/above 95% ok, 80–95% warn, below bad. Pace tone: ahead of last year ok, up to 3 pts behind warn, else bad. */
export const occTone = (r) => (!isNum(r) ? '' : r >= 0.95 ? 'ok' : r >= 0.8 ? 'warn' : 'bad');
export const paceTone = (d) => (!isNum(d) ? null : d >= -0.0005 ? 'ok' : d >= -0.03 ? 'warn' : 'bad');
export function toCSV(rows, columns) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [columns.map((c) => esc(c.label)).join(',')].concat(rows.map((r) => columns.map((c) => esc(c.csv ? c.csv(r) : typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))).join('\n');
}
export function downloadCSV(name, text) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* preview sandboxes block downloads */ }
  return text;
}
