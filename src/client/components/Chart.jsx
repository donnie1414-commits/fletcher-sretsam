/** Hand-rolled SVG charts. Palette from the theme tokens (one accent, one warning, greys). */
import { useState } from 'react';
import { fmtInt, fmtPct, fmtDate } from '../format.js';

export function LineChart({ series, height = 180, yLabel = '', xLabels = [] }) {
  const w = 640, h = height, pad = { l: 44, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const maxY = Math.max(1, ...all);
  const x = (i) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxY) * (h - pad.t - pad.b);
  const ticks = 4;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label={`${yLabel} by week`}>
      {Array.from({ length: ticks + 1 }).map((_, i) => { const v = (maxY / ticks) * i; return <g key={i}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" /><text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart-tick">{fmtInt(v)}</text></g>; })}
      {xLabels.map((lab, i) => <text key={i} x={x(lab.i)} y={h - 8} textAnchor="middle" className="chart-tick">{lab.text}</text>)}
      {series.map((s, k) => <g key={k}><path d={path(s.values)} className={`chart-line chart-line-${k}`} fill="none" />{s.values.length ? <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r="3.5" className={`chart-end chart-line-${k}`} /> : null}</g>)}
      <g className="chart-legend">{series.map((s, k) => <g key={k} transform={`translate(${pad.l + k * 150}, ${pad.t + 4})`}><line x1="0" x2="18" y1="0" y2="0" className={`chart-line chart-line-${k}`} /><text x="24" y="4" className="chart-tick">{s.name}</text></g>)}</g>
    </svg>
  );
}

/**
 * Leasing pace (v2 drawVelocity): cumulative occupancy % at each week end, this AY to the selected week and
 * last year on the same calendar, continuing past the selected week. pts = [[week, occPct, lyOccPct]], ahead = [[week, lyOccPct]].
 */
export function PaceChart({ pts = [], ahead = [], ayStart, curName, lyName, big = false }) {
  if (!pts.length) return <p className="muted small">No dated leases yet.</p>;
  const weeks = pts.map((p) => p[0]).concat(ahead.map((a) => a[0]));
  const cur = pts.map((p, i) => ({ i, v: p[1] }));
  const ly = lyName ? pts.map((p, i) => ({ i, v: p[2] })).concat(ahead.map((a, k) => ({ i: pts.length + k, v: a[1] }))) : [];
  const selI = pts.length - 1, n = weeks.length;
  let ymax = 0; for (const p of cur.concat(ly)) if (p.v != null && p.v > ymax) ymax = p.v;
  const tick = ymax > 0.5 ? 0.2 : 0.1; ymax = Math.min(1, Math.max(tick, Math.ceil(ymax / tick - 1e-9) * tick));
  const W = 960, H = big ? 330 : 270, L = 46, R = 64, T = 14, B = 32;
  const xs = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R), ys = (v) => T + (1 - v / ymax) * (H - T - B);
  const step = Math.max(1, Math.ceil(n / 12));
  let ai = -1; if (ayStart) for (let k = 0; k < n; k++) if (weeks[k] <= ayStart) ai = k;
  const path = (list) => list.filter((p) => p.v != null).map((p, i) => `${i ? 'L' : 'M'}${xs(p.i).toFixed(1)} ${ys(p.v).toFixed(1)}`).join(' ');
  const labels = [];
  const at = (list) => list.find((p) => p.i === selI && p.v != null);
  const a1 = at(ly), a2 = at(cur);
  if (a1) labels.push({ y: ys(a1.v) + 4, t: fmtPct(a1.v), cls: 'ly' }); if (a2) labels.push({ y: ys(a2.v) + 4, t: fmtPct(a2.v), cls: 'cur' });
  if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 16) { const mid = (labels[0].y + labels[1].y) / 2; const hi = labels[0].y <= labels[1].y ? labels[0] : labels[1], lo = hi === labels[0] ? labels[1] : labels[0]; hi.y = mid - 8; lo.y = mid + 8; }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart pace" role="img" aria-label="Leasing pace chart">
        {Array.from({ length: Math.round(ymax / tick) + 1 }).map((_, g) => { const v = tick * g, y = ys(v); return <g key={g}><line x1={L} x2={W - R} y1={y} y2={y} className="chart-grid" /><text x={L - 8} y={y + 4} textAnchor="end" className="chart-tick">{Math.round(v * 100)}%</text></g>; })}
        {weeks.map((wk, x) => (x % step === 0 ? <text key={x} x={xs(x)} y={H - B + 16} textAnchor="middle" className="chart-tick">{fmtDate(wk).replace(/\/\d+$/, '')}</text> : null))}
        {ai >= 0 && ai < n - 1 && <g><line x1={xs(ai)} x2={xs(ai)} y1={T} y2={H - B} className="chart-marker" /><text x={xs(ai) - 4} y={T + 10} textAnchor="end" className="chart-tick">AY start</text></g>}
        <line x1={xs(selI)} x2={xs(selI)} y1={T} y2={H - B} className="chart-sel" />
        {ly.length > 0 && <path d={path(ly)} className="chart-line chart-line-1" fill="none" />}
        <path d={path(cur)} className="chart-line chart-line-0 bold" fill="none" />
        {cur.filter((p) => p.v != null).map((p) => <circle key={p.i} cx={xs(p.i)} cy={ys(p.v)} r="2.5" className="chart-end chart-line-0"><title>{curName} · week of {fmtDate(weeks[p.i])}: {fmtPct(p.v)}</title></circle>)}
        {labels.map((l, i) => <text key={i} x={xs(selI) + 8} y={l.y} className={`chart-label ${l.cls}`}>{l.t}</text>)}
      </svg>
      <div className="legend small"><span><i className="sw sw-0" />{curName}</span>{lyName && <span><i className="sw sw-1" />{lyName}, same week of the cycle</span>}<span className="muted">shaded = selected week</span></div>
    </div>
  );
}

/**
 * Velocity: cumulative beds (or % of beds) by days from the AY start, one line per academic year.
 * rows = [[ayIndex, days, beds, monthly, fund, market, type]] already scoped server-side; filter by type here.
 */
export function VelocityChart({ rows = [], ays = [], totalBeds = 0, basisLabel = '', pct = true, big = false }) {
  const [type, setType] = useState('');
  const [hover, setHover] = useState(null);
  const minD = -400, maxD = 120;
  const series = ays.map((a, yi) => {
    const pts = rows.filter((r) => r[0] === yi && (!type || r[6] === type)).sort((p, q) => p[1] - q[1]);
    let cum = 0; const out = [];
    for (const p of pts) { cum += p[2]; const d = Math.max(minD, Math.min(maxD, p[1])); if (out.length && out[out.length - 1].d === d) out[out.length - 1].v = cum; else out.push({ d, v: cum }); }
    return { name: a.label, pts: out, selected: a.selected, total: cum };
  });
  const W = 960, H = big ? 330 : 260, L = 46, R = 20, T = 14, B = 32;
  const maxV = pct && totalBeds ? 1 : Math.max(1, ...series.map((s) => s.total));
  const val = (v) => (pct && totalBeds ? v / totalBeds : v);
  const xs = (d) => L + ((d - minD) / (maxD - minD)) * (W - L - R), ys = (v) => T + (1 - val(v) / maxV) * (H - T - B);
  const path = (s) => { if (!s.pts.length) return ''; let d = `M${xs(minD).toFixed(1)} ${ys(0).toFixed(1)}`; for (const p of s.pts) d += ` L${xs(p.d).toFixed(1)} ${ys(p.v).toFixed(1)}`; return d; };
  const ticks = pct && totalBeds ? [0, 0.25, 0.5, 0.75, 1].map((v) => v * totalBeds) : [0, 0.25, 0.5, 0.75, 1].map((v) => v * maxV);
  return (
    <div>
      <div className="toolbar small"><span className="seg">{[['', 'All types'], ['WH', 'Whole house'], ['UNIT', 'Unit'], ['BED', 'Bedroom']].map(([v, l]) => <button key={v} type="button" className={`seg-item ${type === v ? 'is-on' : ''}`} onClick={() => setType(v)}>{l}</button>)}</span><span className="muted">{basisLabel} · x = days before (−) / after (+) the academic year start · y = {pct && totalBeds ? 'share of today’s beds' : 'beds'}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart velocity" role="img" aria-label="Leasing velocity by academic year" onMouseLeave={() => setHover(null)}>
        {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} className="chart-grid" /><text x={L - 8} y={ys(v) + 4} textAnchor="end" className="chart-tick">{pct && totalBeds ? `${Math.round(val(v) * 100)}%` : fmtInt(v)}</text></g>)}
        {[-365, -300, -240, -180, -120, -60, 0, 60, 120].map((d) => <g key={d}><line x1={xs(d)} x2={xs(d)} y1={H - B} y2={H - B + 4} className="chart-grid" /><text x={xs(d)} y={H - B + 16} textAnchor="middle" className="chart-tick">{d}</text></g>)}
        <line x1={xs(0)} x2={xs(0)} y1={T} y2={H - B} className="chart-marker" />
        {series.map((s, k) => <path key={k} d={path(s)} className={`chart-line vel-${k} ${s.selected ? 'bold' : ''}`} fill="none" onMouseEnter={() => setHover(k)} />)}
        {hover != null && series[hover] && <text x={W - R} y={T + 12} textAnchor="end" className="chart-label cur">{series[hover].name}: {fmtInt(series[hover].total)} beds</text>}
      </svg>
      <div className="legend small">{series.map((s, k) => <span key={k}><i className={`sw vel-${k}`} />{s.name}{s.selected ? ' (selected)' : ''} · {fmtInt(s.total)}</span>)}</div>
    </div>
  );
}
